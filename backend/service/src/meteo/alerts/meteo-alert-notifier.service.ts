import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { MessageKind } from '@strawboss/types';
import { tServer } from '../../common';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { MESSAGING_SERVICE, type IMessagingService } from '../../messaging/messaging.tokens';
import { NotificationsService } from '../../notifications/notifications.service';
import { localDate, localHour } from '../weather/grid';
import { MeteoAlertsService } from './meteo-alerts.service';

const DAILY_CAP = 3;
const QUIET_FROM_H = 22;
const QUIET_TO_H = 6;
const PARCEL_NAMES_SHOWN = 3;

interface PendingAlert {
  id: string;
  alertType: string;
  severity: string;
  peakValue: number;
  peakAt: string;
  parcelCount: number;
  parcelNames: string[] | null;
}

const UNIT: Record<string, string> = {
  frost: '°C',
  heat: '°C',
  wind: 'm/s',
  heavy_rain: 'mm',
  storm: 'J/kg CAPE',
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const whenFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Push (+ optional email digest) for the alerts not yet notified. Quiet hours
 * 22:00–06:00 local defer warnings; a user gets at most 3 pushes and 3 emails
 * per local day (atomic ledger), at most ONE push per run.
 */
@Injectable()
export class MeteoAlertNotifierService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notifications: NotificationsService,
    private readonly alerts: MeteoAlertsService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async flush(orgId: string): Promise<{ alerts: number; pushes: number; emails: number }> {
    const now = Date.now();
    const today = localDate(now);
    const hour = localHour(now);
    const quiet = hour >= QUIET_FROM_H || hour < QUIET_TO_H;

    const all = (await this.drizzleProvider.db.execute(sql`
      SELECT a.id::text AS id, a.alert_type AS "alertType", a.severity,
        a.peak_value::float8 AS "peakValue",
        to_char(a.peak_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "peakAt",
        a.parcel_count AS "parcelCount",
        (
          SELECT array_agg(q.name) FROM (
            SELECT COALESCE(p.name, p.code) AS name
            FROM unnest(a.parcel_ids) AS u(pid)
            JOIN parcels p ON p.id = u.pid AND p.organization_id = a.organization_id AND p.deleted_at IS NULL
            ORDER BY p.name LIMIT ${PARCEL_NAMES_SHOWN}
          ) q
        ) AS "parcelNames"
      FROM meteo_alerts a
      WHERE a.organization_id = ${orgId}::uuid AND a.notified_at IS NULL
        AND a.acknowledged_at IS NULL AND a.local_day >= ${today}::date AND a.ends_at > now()
      ORDER BY a.peak_at
      LIMIT 50
    `)) as unknown as PendingAlert[];
    const pending = quiet ? all.filter((a) => a.severity === 'severe') : all;
    if (pending.length === 0) return { alerts: 0, pushes: 0, emails: 0 };

    const settings = await this.alerts.getSettings(orgId);
    const sent = new Set<string>();
    let pushes = 0;
    let emails = 0;

    const pushUsers = (await this.drizzleProvider.db.execute(sql`
      SELECT DISTINCT u.id::text AS id
      FROM users u
      JOIN device_push_tokens t ON t.user_id = u.id AND t.is_active = true
      WHERE u.role IN ('admin'::user_role, 'dispatcher'::user_role)
        AND u.deleted_at IS NULL AND u.organization_id = ${orgId}::uuid
    `)) as unknown as { id: string }[];

    // Whole per-user body inside its own try/catch: one bad recipient must not drop the rest.
    for (const u of pushUsers) {
      let bumped = false;
      try {
        const count = await this.bump(u.id, today, orgId, 'push_count');
        if (count === null) continue;
        bumped = true;
        const locale = await this.notifications.localeForUser(u.id);
        const ids = pending.map((a) => a.id);
        const data = { type: 'meteo_alert', alertIds: ids };
        if (count >= DAILY_CAP) {
          await this.notifications.sendPush(u.id, 'push.meteoAlertDigestFinal', { count: pending.length }, data);
        } else if (pending.length === 1) {
          const a = pending[0];
          await this.notifications.sendPush(
            u.id,
            'push.meteoAlert',
            {
              type: tServer(locale, `meteo.alertType.${a.alertType}`),
              severity: tServer(locale, `meteo.severity.${a.severity}`),
              parcels: this.parcelsText(a),
              value: `${a.peakValue} ${UNIT[a.alertType] ?? ''}`.trim(),
              when: whenFmt.format(new Date(a.peakAt)),
            },
            data,
          );
        } else {
          await this.notifications.sendPush(u.id, 'push.meteoAlertDigest', { count: pending.length }, data);
        }
        pushes++;
        pending.forEach((a) => sent.add(a.id));
      } catch (err) {
        // The cap slot was taken before the send: give it back, or a transient
        // DB hiccup would silently cap the user for the rest of the day.
        if (bumped) await this.unbump(u.id, today, 'push_count');
        this.warn('push failed', orgId, u.id, err);
      }
    }

    if (settings.alertsEmail) {
      const admins = (await this.drizzleProvider.db.execute(sql`
        SELECT id::text AS id, email FROM users
        WHERE role = 'admin'::user_role AND deleted_at IS NULL AND organization_id = ${orgId}::uuid
          AND email IS NOT NULL AND email <> ''
      `)) as unknown as { id: string; email: string }[];
      for (const u of admins) {
        let bumped = false;
        try {
          if ((await this.bump(u.id, today, orgId, 'email_count')) === null) continue;
          bumped = true;
          const locale = await this.notifications.localeForUser(u.id);
          const lines = pending.map((a) =>
            tServer(locale, 'meteo.email.line', {
              type: tServer(locale, `meteo.alertType.${a.alertType}`),
              severity: tServer(locale, `meteo.severity.${a.severity}`),
              parcels: a.parcelCount,
              value: `${a.peakValue} ${UNIT[a.alertType] ?? ''}`.trim(),
              when: whenFmt.format(new Date(a.peakAt)),
            }),
          );
          const intro = tServer(locale, 'meteo.email.intro');
          const footer = tServer(locale, 'meteo.email.footer');
          await this.messaging.sendEmail({
            to: u.email,
            subject: tServer(locale, 'meteo.email.subject', { count: pending.length }),
            body: [intro, '', ...lines.map((l) => `- ${l}`), '', footer].join('\n'),
            html: `<p>${esc(intro)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p style="color:#666">${esc(footer)}</p>`,
            kind: MessageKind.meteo_alert_digest,
            metadata: { orgId },
          });
          emails++;
          pending.forEach((a) => sent.add(a.id));
        } catch (err) {
          if (bumped) await this.unbump(u.id, today, 'email_count');
          this.warn('email failed', orgId, u.id, err);
        }
      }
    }

    if (sent.size > 0) {
      await this.drizzleProvider.db.execute(sql`
        UPDATE meteo_alerts SET notified_at = now()
        WHERE organization_id = ${orgId}::uuid AND id = ANY(${`{${[...sent].join(',')}}`}::uuid[])
      `);
    }
    this.winston.log('flow', 'Meteo alerts notified', {
      context: 'MeteoAlertNotifierService',
      orgId,
      alerts: pending.length,
      pushes,
      emails,
      quiet,
    });
    return { alerts: pending.length, pushes, emails };
  }

  private parcelsText(a: PendingAlert): string {
    const names = a.parcelNames ?? [];
    const extra = a.parcelCount - names.length;
    return names.join(', ') + (extra > 0 ? ` +${extra}` : '');
  }

  /** Atomic ledger increment; null = the user is at the daily cap. */
  private async bump(
    userId: string,
    day: string,
    orgId: string,
    col: 'push_count' | 'email_count',
  ): Promise<number | null> {
    const rows = (await (col === 'push_count'
      ? this.drizzleProvider.db.execute(sql`
          INSERT INTO meteo_alert_notifications (user_id, local_day, organization_id, push_count)
          VALUES (${userId}::uuid, ${day}::date, ${orgId}::uuid, 1)
          ON CONFLICT (user_id, local_day) DO UPDATE
            SET push_count = meteo_alert_notifications.push_count + 1, updated_at = now()
            WHERE meteo_alert_notifications.push_count < ${DAILY_CAP}
          RETURNING push_count AS n`)
      : this.drizzleProvider.db.execute(sql`
          INSERT INTO meteo_alert_notifications (user_id, local_day, organization_id, email_count)
          VALUES (${userId}::uuid, ${day}::date, ${orgId}::uuid, 1)
          ON CONFLICT (user_id, local_day) DO UPDATE
            SET email_count = meteo_alert_notifications.email_count + 1, updated_at = now()
            WHERE meteo_alert_notifications.email_count < ${DAILY_CAP}
          RETURNING email_count AS n`))) as unknown as { n: number }[];
    return rows[0]?.n ?? null;
  }

  /** Compensate a bump whose send failed. Best effort — never throws. */
  private async unbump(userId: string, day: string, col: 'push_count' | 'email_count'): Promise<void> {
    await (col === 'push_count'
      ? this.drizzleProvider.db.execute(sql`
          UPDATE meteo_alert_notifications SET push_count = GREATEST(push_count - 1, 0), updated_at = now()
          WHERE user_id = ${userId}::uuid AND local_day = ${day}::date`)
      : this.drizzleProvider.db.execute(sql`
          UPDATE meteo_alert_notifications SET email_count = GREATEST(email_count - 1, 0), updated_at = now()
          WHERE user_id = ${userId}::uuid AND local_day = ${day}::date`)
    ).catch(() => undefined);
  }

  private warn(what: string, orgId: string, userId: string, err: unknown): void {
    this.winston.warn(`Meteo alert ${what}`, {
      context: 'MeteoAlertNotifierService',
      orgId,
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
