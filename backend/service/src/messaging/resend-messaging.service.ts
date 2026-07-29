import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { MessageChannel } from '@strawboss/types';
import type { IMessagingService, SendEmailParams, SendSmsParams } from './messaging.tokens';
import { postResendEmail } from './resend-client';
import { isFeatureEnabled, type FeatureKey } from '@strawboss/types';
import { FeaturesService } from '../features/features.service';

/** Shown in the /messages monitor so the reason is legible, not a mystery. */
const FEATURE_DISABLED_REASON = 'Funcție dezactivată pentru organizație';

/**
 * Real outbound messaging: email via Resend, SMS via the outbound_messages outbox
 * (delivered by the custom SIM-gateway app that polls /fleet/checkin). Every send
 * is persisted to `outbound_messages` for the admin monitor + retry. Email without
 * a configured RESEND_API_KEY is marked failed (honest, actionable) rather than
 * silently dropped. Drop-in for the stub: no call site changes.
 */
@Injectable()
export class ResendMessagingService implements IMessagingService {
  constructor(
    private readonly features: FeaturesService,
    private readonly drizzleProvider: DrizzleProvider,
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  private orgOf(meta?: Record<string, unknown>): string | null {
    const v = meta?.orgId ?? meta?.organizationId;
    return typeof v === 'string' ? v : null;
  }
  private requestOf(meta?: Record<string, unknown>): string | null {
    const v = meta?.requestId ?? meta?.tripRequestId;
    return typeof v === 'string' ? v : null;
  }

  private async insertRow(
    channel: MessageChannel,
    p: { to: string; subject?: string; body: string; html?: string; kind: string },
    orgId: string | null,
    requestId: string | null,
  ): Promise<string> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO outbound_messages (
            organization_id, channel, kind, to_address, subject, body, html, trip_request_id
          ) VALUES (
            ${orgId}::uuid, ${channel}, ${p.kind}, ${p.to}, ${p.subject ?? null},
            ${p.body}, ${p.html ?? null}, ${requestId}::uuid
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    return rows[0].id;
  }

  private async markSent(id: string, providerId: string | null): Promise<void> {
    await this.drizzleProvider.db.execute(
      sql`UPDATE outbound_messages
          SET status = 'sent', provider_message_id = ${providerId}, error = NULL,
              attempts = attempts + 1, sent_at = now(), updated_at = now()
          WHERE id = ${id}::uuid`,
    );
  }

  private async markFailed(id: string, error: string): Promise<void> {
    await this.drizzleProvider.db.execute(
      sql`UPDATE outbound_messages
          SET status = 'failed', error = ${error.slice(0, 500)},
              attempts = attempts + 1, updated_at = now()
          WHERE id = ${id}::uuid`,
    );
  }

  async sendEmail(params: SendEmailParams): Promise<void> {
    const orgId = this.orgOf(params.metadata);
    const id = await this.insertRow(
      MessageChannel.email,
      params,
      orgId,
      this.requestOf(params.metadata),
    );

    if (await this.channelDisabled(orgId, 'messaging.email')) {
      await this.markFailed(id, FEATURE_DISABLED_REASON);
      return;
    }

    const key = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM');
    if (!key || !from) {
      this.winston.warn(`[messaging] email not sent — RESEND not configured (${params.kind})`, {
        context: 'ResendMessagingService',
        to: params.to,
      });
      await this.markFailed(id, 'RESEND_API_KEY / RESEND_FROM not configured');
      return;
    }

    const result = await postResendEmail(key, from, {
      to: params.to,
      subject: params.subject,
      html: params.html ?? null,
      text: params.body,
      attachments: params.attachments,
    });
    if (result.ok) await this.markSent(id, result.providerId ?? null);
    else await this.markFailed(id, result.error ?? 'unknown error');
  }

  async sendSms(params: SendSmsParams): Promise<void> {
    // SMS is delivered by the SIM-gateway app: persist as pending; the device
    // claims it on /fleet/checkin and reports back sent/failed.
    const orgId = this.orgOf(params.metadata);
    const id = await this.insertRow(
      MessageChannel.sms,
      { to: params.to, body: params.body, kind: params.kind },
      orgId,
      this.requestOf(params.metadata),
    );

    if (await this.channelDisabled(orgId, 'messaging.sms')) {
      await this.markFailed(id, FEATURE_DISABLED_REASON);
    }
  }

  /*
   * Gated AFTER the row is written, then marked failed — deliberately.
   *
   * Blocking before the insert would leave nothing at all in /messages, so an
   * operator whose organization has messaging switched off would see silence
   * and no way to find out why. A failed row with a reason is the same promise
   * the rest of the outbox makes: nothing disappears quietly.
   *
   * Fails OPEN when the caller passed no org in metadata — the gate cannot
   * invent one, and refusing to send would be worse than sending.
   */
  private async channelDisabled(orgId: string | null, key: FeatureKey): Promise<boolean> {
    if (!orgId) return false;
    return !isFeatureEnabled(await this.features.getDisabledForOrg(orgId), key);
  }
}
