import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ALERT_DEFAULTS, evaluateMeteoAlerts, type AlertThresholds } from '@strawboss/domain';
import type {
  MeteoAlert,
  MeteoAlertCandidate,
  MeteoAlertSettings,
  UpdateMeteoAlertSettingsDto,
} from '@strawboss/types';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { MeteoAccessService } from '../meteo-access.service';
import { isoSql } from '../meteo-data.service';
import { localDayOf } from '../weather/grid';
import { MeteoFarmWeatherService } from '../weather/meteo-farm-weather.service';

const MAX_PARCELS_PER_ALERT = 50;

/** A candidate plus the parcels behind it (the DTO only carries the count). */
export interface AlertWithParcels extends MeteoAlertCandidate {
  parcelIds: string[];
}

interface SettingsRow {
  alertsEnabled: boolean;
  alertsEmail: boolean;
  frostC: number;
  heatC: number;
  gustMs: number;
  rainMm: number;
  capeJkg: number;
  lookaheadH: number;
}

@Injectable()
export class MeteoAlertsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    private readonly farm: MeteoFarmWeatherService,
  ) {}

  async getSettings(orgId: string): Promise<MeteoAlertSettings> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT alerts_enabled AS "alertsEnabled", alerts_email AS "alertsEmail",
        alert_frost_c::float8 AS "frostC", alert_heat_c::float8 AS "heatC",
        alert_gust_ms::float8 AS "gustMs", alert_rain_mm::float8 AS "rainMm",
        alert_cape_jkg AS "capeJkg", alert_lookahead_h AS "lookaheadH"
      FROM meteo_org_settings WHERE organization_id = ${orgId}::uuid LIMIT 1
    `)) as unknown as SettingsRow[];
    return (
      rows[0] ?? { alertsEnabled: false, alertsEmail: false, ...ALERT_DEFAULTS }
    );
  }

  /** Call AFTER the route's @RequireFeature; assertOptedIn guarantees the settings row exists. */
  async updateSettings(
    orgId: string,
    userId: string,
    dto: UpdateMeteoAlertSettingsDto,
  ): Promise<MeteoAlertSettings> {
    await this.access.assertOptedIn(orgId);
    await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_org_settings SET
        alerts_enabled    = COALESCE(${dto.alertsEnabled ?? null}::boolean, alerts_enabled),
        alerts_email      = COALESCE(${dto.alertsEmail ?? null}::boolean, alerts_email),
        alert_frost_c     = COALESCE(${dto.frostC ?? null}::numeric, alert_frost_c),
        alert_heat_c      = COALESCE(${dto.heatC ?? null}::numeric, alert_heat_c),
        alert_gust_ms     = COALESCE(${dto.gustMs ?? null}::numeric, alert_gust_ms),
        alert_rain_mm     = COALESCE(${dto.rainMm ?? null}::numeric, alert_rain_mm),
        alert_cape_jkg    = COALESCE(${dto.capeJkg ?? null}::int, alert_cape_jkg),
        alert_lookahead_h = COALESCE(${dto.lookaheadH ?? null}::int, alert_lookahead_h),
        alerts_updated_by = ${userId}::uuid
      WHERE organization_id = ${orgId}::uuid
    `);
    return this.getSettings(orgId);
  }

  private selectAlerts(orgId: string, extra: SQL): SQL {
    return sql`
      SELECT a.id::text AS id, a.alert_type AS "alertType", a.severity, a.cell_key AS "cellKey",
        to_char(a.local_day, 'YYYY-MM-DD') AS "localDay",
        ${isoSql(sql`a.starts_at`)} AS "startsAt", ${isoSql(sql`a.ends_at`)} AS "endsAt",
        ${isoSql(sql`a.peak_at`)} AS "peakAt",
        a.peak_value::float8 AS "peakValue", a.threshold::float8 AS threshold,
        a.parcel_count AS "parcelCount",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'code', q.code))
          FROM (
            SELECT p.id::text AS id, p.name, p.code
            FROM unnest(a.parcel_ids) AS u(pid)
            JOIN parcels p ON p.id = u.pid AND p.organization_id = a.organization_id AND p.deleted_at IS NULL
            ORDER BY p.name
            LIMIT 20
          ) q
        ), '[]'::jsonb) AS parcels,
        ${isoSql(sql`a.notified_at`)} AS "notifiedAt",
        ${isoSql(sql`a.acknowledged_at`)} AS "acknowledgedAt",
        ${isoSql(sql`a.created_at`)} AS "createdAt"
      FROM meteo_alerts a
      WHERE a.organization_id = ${orgId}::uuid ${extra}
    `;
  }

  async list(orgId: string, days = 7): Promise<MeteoAlert[]> {
    return (await this.drizzleProvider.db.execute(sql`
      ${this.selectAlerts(
        orgId,
        sql`AND a.local_day >= ((now() AT TIME ZONE 'Europe/Bucharest')::date - ${days}::int)`,
      )}
      ORDER BY a.local_day DESC, (a.severity = 'severe') DESC, a.peak_at
      LIMIT 300
    `)) as unknown as MeteoAlert[];
  }

  async ack(orgId: string, id: string, userId: string): Promise<MeteoAlert> {
    await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_alerts SET acknowledged_at = now(), acknowledged_by = ${userId}::uuid
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND acknowledged_at IS NULL
    `);
    const rows = (await this.drizzleProvider.db.execute(sql`
      ${this.selectAlerts(orgId, sql`AND a.id = ${id}::uuid`)} LIMIT 1
    `)) as unknown as MeteoAlert[];
    if (!rows[0]) throw new NotFoundException('Alert not found');
    return rows[0];
  }

  /** Evaluate every active cell of the org against its forecast; write (or just return) the candidates. */
  async evaluateOrg(
    orgId: string,
    opts: { dryRun: boolean },
  ): Promise<{ candidates: AlertWithParcels[] }> {
    const s = await this.getSettings(orgId);
    const th: AlertThresholds = {
      frostC: s.frostC,
      heatC: s.heatC,
      gustMs: s.gustMs,
      rainMm: s.rainMm,
      capeJkg: s.capeJkg,
      lookaheadH: s.lookaheadH,
    };
    const { cells } = await this.farm.listActiveCells(orgId, 'active', { geometry: false });
    const wx = await this.farm.getCells(cells, opts.dryRun ? 'interactive' : 'background');
    const now = Date.now();
    const candidates: AlertWithParcels[] = [];
    for (const cell of cells) {
      const w = wx.get(cell.key);
      if (!w) continue;
      for (const c of evaluateMeteoAlerts(w.hours, now, th, localDayOf)) {
        candidates.push({
          alertType: c.alertType,
          severity: c.severity,
          cellKey: cell.key,
          localDay: c.localDay,
          startsAt: new Date(c.startMs).toISOString(),
          endsAt: new Date(c.endMs).toISOString(),
          peakAt: new Date(c.peakMs).toISOString(),
          peakValue: c.peakValue,
          threshold: c.threshold,
          parcelCount: cell.parcelIds.length,
          parcelIds: cell.parcelIds.slice(0, MAX_PARCELS_PER_ALERT),
        });
      }
    }
    if (!opts.dryRun) for (const c of candidates) await this.upsert(orgId, c);
    return { candidates };
  }

  /**
   * One row per (org, type, cell, local day). A later run refreshes the row but
   * NEVER downgrades severe → warning (the WHERE skips that update), and a
   * warning → severe escalation re-arms the notification.
   */
  private async upsert(orgId: string, c: AlertWithParcels): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      INSERT INTO meteo_alerts (
        organization_id, alert_type, severity, cell_key, local_day,
        starts_at, ends_at, peak_at, peak_value, threshold, parcel_ids, parcel_count
      ) VALUES (
        ${orgId}::uuid, ${c.alertType}, ${c.severity}, ${c.cellKey}, ${c.localDay}::date,
        ${c.startsAt}::timestamptz, ${c.endsAt}::timestamptz, ${c.peakAt}::timestamptz,
        ${c.peakValue}, ${c.threshold}, ${`{${c.parcelIds.join(',')}}`}::uuid[], ${c.parcelCount}
      )
      ON CONFLICT (organization_id, alert_type, cell_key, local_day) DO UPDATE SET
        severity     = EXCLUDED.severity,
        peak_value   = EXCLUDED.peak_value,
        peak_at      = EXCLUDED.peak_at,
        starts_at    = EXCLUDED.starts_at,
        ends_at      = EXCLUDED.ends_at,
        threshold    = EXCLUDED.threshold,
        parcel_ids   = EXCLUDED.parcel_ids,
        parcel_count = EXCLUDED.parcel_count,
        escalated_at = CASE WHEN meteo_alerts.severity = 'warning' AND EXCLUDED.severity = 'severe'
                            THEN now() ELSE meteo_alerts.escalated_at END,
        notified_at  = CASE WHEN meteo_alerts.severity = 'warning' AND EXCLUDED.severity = 'severe'
                            THEN NULL ELSE meteo_alerts.notified_at END
      WHERE NOT (meteo_alerts.severity = 'severe' AND EXCLUDED.severity = 'warning')
    `);
  }
}
