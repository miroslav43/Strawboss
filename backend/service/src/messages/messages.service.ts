import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { postResendEmail } from '../messaging/resend-client';
import type { OutboundMessageRecord } from '@strawboss/types';

const COLS = sql`
  id,
  organization_id     AS "organizationId",
  channel, kind,
  to_address          AS "toAddress",
  subject,
  left(body, 200)     AS "bodyPreview",
  status,
  provider_message_id AS "providerMessageId",
  error, attempts,
  trip_request_id     AS "tripRequestId",
  claimed_by_device   AS "claimedByDevice",
  sent_at             AS "sentAt",
  delivered_at        AS "deliveredAt",
  created_at          AS "createdAt",
  updated_at          AS "updatedAt"
`;

/** Admin monitor for the outbound_messages outbox (email + SMS) + manual retry. */
@Injectable()
export class MessagesService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async list(
    orgId: string,
    filters: { channel?: string; status?: string },
  ): Promise<OutboundMessageRecord[]> {
    const conds = [sql`organization_id = ${orgId}::uuid`];
    if (filters.channel) conds.push(sql`channel = ${filters.channel}`);
    if (filters.status) conds.push(sql`status = ${filters.status}`);
    const where = sql.join(conds, sql` AND `);
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${COLS} FROM outbound_messages WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    );
    return rows as unknown as OutboundMessageRecord[];
  }

  async retry(orgId: string, id: string): Promise<{ ok: true }> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, channel, to_address AS "to", subject, body, html
          FROM outbound_messages
          WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid
          LIMIT 1`,
    )) as unknown as {
      id: string;
      channel: string;
      to: string;
      subject: string | null;
      body: string;
      html: string | null;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Message not found');

    // SMS: reset to pending so a gateway device re-claims and re-sends it.
    if (row.channel === 'sms') {
      await this.drizzleProvider.db.execute(
        sql`UPDATE outbound_messages
            SET status = 'pending', claimed_by_device = NULL, error = NULL, updated_at = now()
            WHERE id = ${id}::uuid`,
      );
      return { ok: true };
    }

    // Email: re-POST to Resend, updating this same row.
    const key = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM');
    if (!key || !from) throw new BadRequestException('RESEND_API_KEY / RESEND_FROM not configured');
    const result = await postResendEmail(key, from, {
      to: row.to,
      subject: row.subject ?? '',
      html: row.html,
      text: row.body,
    });
    if (!result.ok) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE outbound_messages
            SET status = 'failed', error = ${(result.error ?? 'error').slice(0, 500)},
                attempts = attempts + 1, updated_at = now()
            WHERE id = ${id}::uuid`,
      );
      throw new BadRequestException(result.error ?? 'send failed');
    }
    await this.drizzleProvider.db.execute(
      sql`UPDATE outbound_messages
          SET status = 'sent', provider_message_id = ${result.providerId ?? null}, error = NULL,
              attempts = attempts + 1, sent_at = now(), updated_at = now()
          WHERE id = ${id}::uuid`,
    );
    return { ok: true };
  }
}
