import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import {
  MESSAGING_SERVICE,
  type IMessagingService,
  type EmailAttachment,
} from './messaging.tokens';
import { messageTemplates } from './message-templates';
import { MessageKind } from '@strawboss/types';
import { signUploadUrl, UPLOADS_URL_PREFIX } from '../uploads/uploads-signing';
import { resolveUploadsRoot } from '../uploads/uploads.service';

interface NotifyRecipientRow {
  name: string;
  phone: string | null;
  email: string | null;
}

interface AvizRequestRow {
  requester_name: string;
  requester_email: string | null;
  requester_phone: string | null;
  driver_name: string;
  driver_email: string | null;
  driver_phone: string;
  company_name: string | null;
  truck_registration_plate: string | null;
  needed_date: string | null;
  notify_recipients: NotifyRecipientRow[];
  organization_id: string;
  beneficiary_email: string | null;
  beneficiary_name: string | null;
}

/**
 * Sends an uploaded aviz to every recipient of a request — an EMAIL with the PDF
 * attached + a download link, and an SMS with the download link. Reuses the
 * deduped fan-out of the transport-confirmation flow. Invoked by the single
 * `message-send` worker (TransportConfirmationProcessor) on the 'aviz-uploaded'
 * job — NOT a second worker on the queue (which would compete for jobs).
 */
@Injectable()
export class AvizNotificationService {
  private readonly jwtSecret: string;

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly config: ConfigService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {
    this.jwtSecret = config.getOrThrow<string>('SUPABASE_JWT_SECRET');
  }

  /** Public web/API origin (same host in prod) used to absolutize the signed link. */
  private publicWebBaseUrl(): string {
    return (
      this.config.get<string>('NEXT_PUBLIC_SITE_URL') ??
      this.config.get<string>('PUBLIC_WEB_URL') ??
      'https://nortiauno.com'
    ).replace(/\/$/, '');
  }

  async dispatch(requestId: string, fileUrl: string): Promise<void> {
    const reqRows = (await this.drizzleProvider.db.execute(
      sql`SELECT tr.requester_name, tr.requester_email, tr.requester_phone,
                 tr.driver_name, tr.driver_email, tr.driver_phone,
                 tr.company_name, tr.truck_registration_plate, tr.needed_date,
                 tr.notify_recipients, tr.organization_id,
                 b.email        AS beneficiary_email,
                 b.display_name AS beneficiary_name
          FROM trip_requests tr
          LEFT JOIN beneficiaries b ON b.id = tr.beneficiary_id AND b.deleted_at IS NULL
          WHERE tr.id = ${requestId}::uuid LIMIT 1`,
    )) as unknown as AvizRequestRow[];
    const req = reqRows[0];
    if (!req) return;

    const orgRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name FROM organizations WHERE id = ${req.organization_id}::uuid LIMIT 1`,
    )) as unknown as { name: string }[];
    const orgName = orgRows[0]?.name ?? 'StrawBoss';

    // Absolute, signed, no-auth download link (valid ~7 days). The egress
    // interceptor only signs HTTP responses, so we sign here (as fleet.service does).
    const downloadUrl = `${this.publicWebBaseUrl()}${signUploadUrl(fileUrl, this.jwtSecret, Date.now())}`;

    // Read the PDF from the shared uploads bind-mount to attach to the email.
    // The stored fileUrl is `/api/v1/uploads/avize/<uuid>.pdf` (no query).
    let attachments: EmailAttachment[] | undefined;
    try {
      const key = fileUrl.startsWith(UPLOADS_URL_PREFIX)
        ? fileUrl.slice(UPLOADS_URL_PREFIX.length)
        : fileUrl.replace(/^\//, '');
      const abs = path.join(resolveUploadsRoot(this.config), key);
      const content = (await fsp.readFile(abs)).toString('base64');
      const filename = `aviz-${req.truck_registration_plate ?? requestId}.pdf`.replace(
        /[^\w.\-]+/g,
        '_',
      );
      attachments = [{ filename, content, contentType: 'application/pdf' }];
    } catch (err) {
      this.winston.warn('aviz-uploaded: could not read PDF for attachment; sending link only', {
        context: 'AvizNotificationService',
        requestId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }

    const meta = { orgId: req.organization_id, requestId };

    // Deduped recipient sets — same fan-out order as the confirmation processor:
    // driver first, then the beneficiary email, then every selected contact, with
    // a legacy fallback to the single requester when notify_recipients is empty.
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const emailRecipients: Array<{ to: string; name: string | null }> = [];
    const smsRecipients: string[] = [];

    const addEmail = (raw: string | null, name: string | null) => {
      if (!raw) return;
      const key = raw.trim().toLowerCase();
      if (!key || seenEmails.has(key)) return;
      seenEmails.add(key);
      emailRecipients.push({ to: raw, name });
    };
    const addSms = (raw: string | null) => {
      if (!raw) return;
      const key = raw.replace(/[\s\-()]/g, '');
      if (!key || seenPhones.has(key)) return;
      seenPhones.add(key);
      smsRecipients.push(raw);
    };

    addEmail(req.driver_email, req.driver_name);
    addSms(req.driver_phone);
    addEmail(req.beneficiary_email, req.beneficiary_name ?? req.company_name);
    const notifyRecipients = Array.isArray(req.notify_recipients) ? req.notify_recipients : [];
    for (const r of notifyRecipients) {
      addEmail(r.email, r.name);
      addSms(r.phone);
    }
    if (notifyRecipients.length === 0) {
      addEmail(req.requester_email, req.requester_name);
      addSms(req.requester_phone);
    }

    const logoUrl = this.config.get<string>('EMAIL_LOGO_URL') ?? null;

    // One email per distinct recipient (personalized greeting + PDF attachment).
    for (const r of emailRecipients) {
      const tpl = messageTemplates[MessageKind.aviz_uploaded]({
        organizationName: orgName,
        recipientName: r.name,
        companyName: req.company_name,
        truckRegistrationPlate: req.truck_registration_plate,
        neededDate: req.needed_date,
        downloadUrl,
        logoUrl,
      });
      await this.messaging.sendEmail({
        to: r.to,
        subject: tpl.subject,
        body: tpl.body,
        html: tpl.html,
        attachments,
        kind: MessageKind.aviz_uploaded,
        metadata: meta,
      });
    }

    // One SMS (download link) per distinct phone.
    if (smsRecipients.length) {
      const sms = messageTemplates[MessageKind.aviz_uploaded_sms]({
        truckRegistrationPlate: req.truck_registration_plate,
        downloadUrl,
      });
      for (const to of smsRecipients) {
        await this.messaging.sendSms({
          to,
          body: sms.body,
          kind: MessageKind.aviz_uploaded_sms,
          metadata: meta,
        });
      }
    }

    this.winston.log('flow', `Aviz notification dispatched for request ${requestId}`, {
      context: 'AvizNotificationService',
      requestId,
      emails: emailRecipients.length,
      smsCount: smsRecipients.length,
      attached: !!attachments,
    });
  }
}
