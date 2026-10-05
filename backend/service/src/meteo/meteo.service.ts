import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import {
  HOUR_MS,
  compareByStatusAndUrgency,
  deriveStatus,
  floorHour,
  requiredHoursFor,
} from '@strawboss/domain';
import {
  METEO_ATTRIBUTION,
  isFeatureEnabled,
  type CreateHarvestEventDto,
  type CreateMoistureReadingDto,
  type FeatureKey,
  type MeteoBaleFingerprint,
  type MeteoDerivedStatus,
  type MeteoHarvestEvent,
  type MeteoHarvestSuggestion,
  type MeteoHourPoint,
  type MeteoMoistureReading,
  type MeteoOrgSettings,
  type MeteoOverview,
  type MeteoOverviewRow,
  type MeteoParcelDetail,
  type MeteoReason,
  type MeteoStatus,
  type UpdateHarvestEventDto,
  type UpdateMeteoSettingsDto,
} from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { SeasonsService } from '../seasons/seasons.service';
import { MeteoAccessService, meteoJobsEnabled } from './meteo-access.service';
import { MeteoClient } from './meteo-client';
import { MeteoDataService, asJson, epochMsSql, isoSql } from './meteo-data.service';
import { METEO_MODEL_VERSION } from './meteo.constants';

const PG_UNIQUE_VIOLATION = '23505';

/** Columns of one meteo_harvest_events row, single-table queries only. */
const EVENT_COLS = sql`
  id::text AS id,
  organization_id::text AS "organizationId",
  parcel_id::text AS "parcelId",
  ${isoSql(sql`harvested_at`)} AS "harvestedAt",
  harvested_at_basis AS "harvestedAtBasis",
  crop_type AS "cropType",
  swath_type AS "swathType",
  ${isoSql(sql`closed_at`)} AS "closedAt",
  close_reason AS "closeReason",
  ${isoSql(sql`created_at`)} AS "createdAt",
  ${isoSql(sql`updated_at`)} AS "updatedAt"
`;

const READING_COLS = sql`
  id::text AS id,
  parcel_id::text AS "parcelId",
  harvest_event_id::text AS "harvestEventId",
  ${isoSql(sql`measured_at`)} AS "measuredAt",
  moisture_wb::float8 AS "moistureWb",
  kind,
  bale_production_id::text AS "baleProductionId",
  lat::float8 AS lat,
  lon::float8 AS lon,
  source,
  created_by::text AS "createdBy",
  ${isoSql(sql`created_at`)} AS "createdAt"
`;

/** Current baled_at of a bale_productions row — same expression the fingerprint job uses. */
const BP_BALED_AT = sql`COALESCE(bp.end_time, bp.start_time,
  (bp.production_date + time '12:00') AT TIME ZONE 'Europe/Bucharest')`;

interface StoredBasis {
  models?: string[];
  newestIssuedAt?: string | null;
  blocking?: MeteoReason | null;
}

interface OverviewSqlRow {
  harvestEventId: string;
  parcelId: string;
  parcelName: string | null;
  parcelCode: string | null;
  cropType: string | null;
  areaHa: number | null;
  harvestedAt: string;
  swathType: MeteoOverviewRow['swathType'];
  computedAtMs: number | null;
  computedAt: string | null;
  basis: unknown;
  hourly: unknown;
  lastReadingAt: string | null;
  lastReadingWb: number | null;
  boundary: unknown;
}

/** postgres.js surfaces the SQLSTATE as `code`; tolerate a wrapped driver error. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

@Injectable()
export class MeteoService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    private readonly data: MeteoDataService,
    private readonly client: MeteoClient,
    private readonly seasons: SeasonsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  // ── status / settings ──────────────────────────────────────────────────────

  async getStatus(orgId: string, disabledFeatures: readonly string[]): Promise<MeteoStatus> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT ${isoSql(sql`max(fetched_at)`)} AS "lastIngestAt" FROM meteo_forecast_latest
    `)) as unknown as Array<{ lastIngestAt: string | null }>;
    const optedIn = await this.access.isOptedIn(orgId);
    const on = (key: FeatureKey): boolean => optedIn && isFeatureEnabled(disabledFeatures, key);
    // Only read the alert opt-in when the feature switches could make it matter.
    const alertsOptIn =
      on('meteo') && on('meteo.alerts')
        ? (
            (await this.drizzleProvider.db.execute(sql`
              SELECT alerts_enabled FROM meteo_org_settings
              WHERE organization_id = ${orgId}::uuid LIMIT 1
            `)) as unknown as Array<{ alerts_enabled: boolean }>
          )[0]?.alerts_enabled === true
        : false;
    return {
      configured: this.client.configured,
      publicApi: this.client.publicApi,
      jobsEnabled: meteoJobsEnabled(),
      enabled: on('meteo'),
      lastIngestAt: rows[0]?.lastIngestAt ?? null,
      attribution: METEO_ATTRIBUTION,
      modelVersion: METEO_MODEL_VERSION,
      forecastEnabled: on('meteo') && on('meteo.forecast'),
      climateConfigured: this.client.archiveConfigured,
      climateEnabled: on('meteo') && on('meteo.climate'),
      alertsEnabled: alertsOptIn,
    };
  }

  getSettings(orgId: string): Promise<MeteoOrgSettings> {
    return this.access.getSettings(orgId);
  }

  /** The opt-in itself: deliberately NOT behind assertOptedIn. */
  async updateSettings(
    orgId: string,
    userId: string,
    dto: UpdateMeteoSettingsDto,
  ): Promise<MeteoOrgSettings> {
    const d = {
      enabled: dto.enabled ?? null,
      thresholdWb: dto.thresholdWb ?? null,
      baleableFracMin: dto.baleableFracMin ?? null,
      rainProbMax: dto.rainProbMax ?? null,
      pressCapacityHaH: dto.pressCapacityHaH ?? null,
      minWindowH: dto.minWindowH ?? null,
      defaultMc0Wb: dto.defaultMc0Wb ?? null,
      activeDays: dto.activeDays ?? null,
    };
    await this.drizzleProvider.db.execute(sql`
      INSERT INTO meteo_org_settings (
        organization_id, enabled, enabled_at, threshold_wb, baleable_frac_min, rain_prob_max,
        press_capacity_ha_h, min_window_h, default_mc0_wb, active_days, updated_by
      ) VALUES (
        ${orgId}::uuid,
        COALESCE(${d.enabled}::boolean, false),
        CASE WHEN ${d.enabled}::boolean IS TRUE THEN now() END,
        COALESCE(${d.thresholdWb}::numeric, 0.15),
        COALESCE(${d.baleableFracMin}::numeric, 0.80),
        COALESCE(${d.rainProbMax}::numeric, 0.20),
        COALESCE(${d.pressCapacityHaH}::numeric, 3.0),
        COALESCE(${d.minWindowH}::int, 3),
        COALESCE(${d.defaultMc0Wb}::numeric, 0.30),
        COALESCE(${d.activeDays}::int, 21),
        ${userId}::uuid
      )
      ON CONFLICT (organization_id) DO UPDATE SET
        enabled = COALESCE(${d.enabled}::boolean, meteo_org_settings.enabled),
        enabled_at = CASE
          WHEN ${d.enabled}::boolean IS TRUE AND NOT meteo_org_settings.enabled THEN now()
          ELSE meteo_org_settings.enabled_at END,
        threshold_wb = COALESCE(${d.thresholdWb}::numeric, meteo_org_settings.threshold_wb),
        baleable_frac_min = COALESCE(${d.baleableFracMin}::numeric, meteo_org_settings.baleable_frac_min),
        rain_prob_max = COALESCE(${d.rainProbMax}::numeric, meteo_org_settings.rain_prob_max),
        press_capacity_ha_h = COALESCE(${d.pressCapacityHaH}::numeric, meteo_org_settings.press_capacity_ha_h),
        min_window_h = COALESCE(${d.minWindowH}::int, meteo_org_settings.min_window_h),
        default_mc0_wb = COALESCE(${d.defaultMc0Wb}::numeric, meteo_org_settings.default_mc0_wb),
        active_days = COALESCE(${d.activeDays}::int, meteo_org_settings.active_days),
        updated_by = ${userId}::uuid
    `);
    this.winston.log('flow', 'Meteo settings updated', {
      context: 'MeteoService',
      orgId,
      userId,
      enabled: dto.enabled,
    });
    // Thresholds feed the engine output — refresh every open clock.
    await this.recompute(orgId).catch(() => undefined);
    return this.access.getSettings(orgId);
  }

  // ── overview ───────────────────────────────────────────────────────────────

  /** Status for `nowMs` from the stored series; read-time, never stored. */
  private derive(
    hourly: MeteoHourPoint[],
    basis: StoredBasis | null,
    computedAtMs: number | null,
    areaHa: number | null,
    settings: MeteoOrgSettings,
    nowMs: number,
  ): MeteoDerivedStatus {
    return deriveStatus(hourly, {
      atMs: nowMs,
      requiredHours: requiredHoursFor(areaHa, settings.pressCapacityHaH),
      minWindowH: settings.minWindowH,
      areaHa,
      computedAtMs,
      newestIssuedAtMs: basis?.newestIssuedAt ? Date.parse(basis.newestIssuedAt) : null,
      baleableFracMin: settings.baleableFracMin,
      rainProbMax: settings.rainProbMax,
      blockingReason: basis?.blocking ?? null,
    });
  }

  private dataAgeH(basis: StoredBasis | null, nowMs: number): number | null {
    if (!basis?.newestIssuedAt) return null;
    return Math.round(((nowMs - Date.parse(basis.newestIssuedAt)) / HOUR_MS) * 10) / 10;
  }

  async getOverview(orgId: string): Promise<MeteoOverview> {
    const db = this.drizzleProvider.db;
    const settings = await this.access.getSettings(orgId);
    const nowMs = Date.now();
    const curLabel = floorHour(nowMs) + (nowMs % HOUR_MS === 0 ? 0 : HOUR_MS);

    const rows = (await db.execute(sql`
      SELECT
        e.id::text AS "harvestEventId", e.parcel_id::text AS "parcelId",
        p.name AS "parcelName", p.code AS "parcelCode", e.crop_type AS "cropType",
        COALESCE(p.area_hectares, ST_Area(p.boundary::geography) / 10000)::float8 AS "areaHa",
        ${isoSql(sql`e.harvested_at`)} AS "harvestedAt", e.swath_type AS "swathType",
        ${epochMsSql(sql`l.computed_at`)} AS "computedAtMs", ${isoSql(sql`l.computed_at`)} AS "computedAt",
        l.basis, l.hourly,
        ${isoSql(sql`lr.measured_at`)} AS "lastReadingAt", lr.moisture_wb::float8 AS "lastReadingWb",
        ST_AsGeoJSON(p.boundary)::json AS boundary
      FROM meteo_harvest_events e
      JOIN parcels p ON p.id = e.parcel_id AND p.organization_id = e.organization_id
      LEFT JOIN meteo_straw_latest l ON l.harvest_event_id = e.id
      LEFT JOIN LATERAL (
        SELECT r.measured_at, r.moisture_wb
        FROM meteo_moisture_readings r
        WHERE r.organization_id = e.organization_id AND r.parcel_id = e.parcel_id AND r.deleted_at IS NULL
        ORDER BY r.measured_at DESC
        LIMIT 1
      ) lr ON true
      WHERE e.organization_id = ${orgId}::uuid AND e.closed_at IS NULL AND e.deleted_at IS NULL
      ORDER BY e.harvested_at
      LIMIT 500
    `)) as unknown as OverviewSqlRow[];

    const out: MeteoOverviewRow[] = rows.map((r) => {
      const hourly = r.hourly ? asJson<MeteoHourPoint[]>(r.hourly) : [];
      const basis = r.basis ? asJson<StoredBasis>(r.basis) : null;
      const derived = this.derive(hourly, basis, r.computedAtMs, r.areaHa, settings, nowMs);
      const cur = hourly.find((p) => Date.parse(p.time) === curLabel);
      return {
        ...derived,
        harvestEventId: r.harvestEventId,
        parcelId: r.parcelId,
        parcelName: r.parcelName,
        parcelCode: r.parcelCode,
        cropType: r.cropType,
        areaHa: r.areaHa,
        harvestedAt: r.harvestedAt,
        swathType: r.swathType,
        mcP10: cur?.p10 ?? null,
        mcP50: cur?.p50 ?? null,
        mcP90: cur?.p90 ?? null,
        lastReadingAt: r.lastReadingAt,
        lastReadingWb: r.lastReadingWb,
        computedAt: r.computedAt,
        dataAgeH: this.dataAgeH(basis, nowMs),
        boundary: r.boundary ?? null,
      };
    });
    out.sort(compareByStatusAndUrgency);

    return {
      rows: out,
      suggestions: await this.getSuggestions(orgId),
      thresholdWb: settings.thresholdWb,
    };
  }

  /** Parcels in harvest but without a drying clock; hintAt comes from audit_logs. */
  private async getSuggestions(orgId: string): Promise<MeteoHarvestSuggestion[]> {
    const db = this.drizzleProvider.db;
    const base = (await db.execute(sql`
      SELECT p.id::text AS "parcelId", p.name AS "parcelName", p.code AS "parcelCode",
             p.harvest_status::text AS "harvestStatus", p.crop_type::text AS "cropType"
      FROM parcels p
      WHERE p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
        AND p.harvest_status IN ('to_harvest', 'harvesting')
        AND NOT EXISTS (
          SELECT 1 FROM meteo_harvest_events e
          WHERE e.parcel_id = p.id AND e.closed_at IS NULL AND e.deleted_at IS NULL
        )
      ORDER BY p.name
      LIMIT 200
    `)) as unknown as Array<Omit<MeteoHarvestSuggestion, 'hintAt'>>;
    if (base.length === 0) return [];

    // The parcels audit trigger (00023) records every harvest_status change with
    // the new row in new_values. A failure here only loses the hint, never the list.
    const hints = new Map<string, string>();
    try {
      const rows = (await db.execute(sql`
        SELECT a.record_id::text AS "parcelId", ${isoSql(sql`min(a.created_at)`)} AS "hintAt"
        FROM audit_logs a
        WHERE a.table_name = 'parcels'
          AND a.record_id IN (
            SELECT p.id FROM parcels p
            WHERE p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
              AND p.harvest_status IN ('to_harvest', 'harvesting')
          )
          AND a.created_at >= date_trunc('year', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest'
          AND a.new_values ->> 'harvest_status' IN ('to_harvest', 'harvesting')
          AND (a.old_values IS NULL
               OR a.old_values ->> 'harvest_status' IS DISTINCT FROM a.new_values ->> 'harvest_status')
        GROUP BY a.record_id
        LIMIT 500
      `)) as unknown as Array<{ parcelId: string; hintAt: string | null }>;
      for (const r of rows) if (r.hintAt) hints.set(r.parcelId, r.hintAt);
    } catch (err) {
      this.winston.warn('Meteo suggestion hints unavailable', {
        context: 'MeteoService',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return base.map((b) => ({ ...b, hintAt: hints.get(b.parcelId) ?? null }));
  }

  // ── parcel detail ──────────────────────────────────────────────────────────

  async getParcelDetail(orgId: string, parcelId: string, hours = 72): Promise<MeteoParcelDetail> {
    const db = this.drizzleProvider.db;
    const parcelRows = (await db.execute(sql`
      SELECT p.name AS "parcelName", p.code AS "parcelCode",
             COALESCE(p.area_hectares, ST_Area(p.boundary::geography) / 10000)::float8 AS "areaHa"
      FROM parcels p
      WHERE p.id = ${parcelId}::uuid AND p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{
      parcelName: string | null;
      parcelCode: string | null;
      areaHa: number | null;
    }>;
    const parcel = parcelRows[0];
    if (!parcel) throw new NotFoundException('Parcel not found');

    const settings = await this.access.getSettings(orgId);
    const base = {
      parcelId,
      parcelName: parcel.parcelName,
      parcelCode: parcel.parcelCode,
      areaHa: parcel.areaHa,
      thresholdWb: settings.thresholdWb,
    };

    const events = (await db.execute(sql`
      SELECT ${EVENT_COLS}
      FROM meteo_harvest_events
      WHERE parcel_id = ${parcelId}::uuid AND organization_id = ${orgId}::uuid
        AND closed_at IS NULL AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as MeteoHarvestEvent[];
    const event = events[0] ?? null;
    if (!event) {
      return {
        ...base,
        event: null,
        derived: null,
        hours: [],
        models: [],
        computedAt: null,
        dataAgeH: null,
        mc0Source: null,
        mc0At: null,
        modelVersion: null,
      };
    }

    const latestRows = (await db.execute(sql`
      SELECT ${epochMsSql(sql`computed_at`)} AS "computedAtMs", ${isoSql(sql`computed_at`)} AS "computedAt",
             basis, hourly, mc0_source AS "mc0Source", ${isoSql(sql`mc0_at`)} AS "mc0At",
             model_version AS "modelVersion"
      FROM meteo_straw_latest
      WHERE harvest_event_id = ${event.id}::uuid AND organization_id = ${orgId}::uuid
      LIMIT 1
    `)) as unknown as Array<{
      computedAtMs: number;
      computedAt: string;
      basis: unknown;
      hourly: unknown;
      mc0Source: string | null;
      mc0At: string | null;
      modelVersion: string;
    }>;
    const latest = latestRows[0];
    const nowMs = Date.now();
    const hourly = latest ? asJson<MeteoHourPoint[]>(latest.hourly) : [];
    const basis = latest ? asJson<StoredBasis>(latest.basis) : null;
    const derived = this.derive(
      hourly,
      basis,
      latest?.computedAtMs ?? null,
      parcel.areaHa,
      settings,
      nowMs,
    );

    const from = nowMs - 24 * HOUR_MS;
    const to = nowMs + hours * HOUR_MS;
    return {
      ...base,
      event,
      derived,
      hours: hourly.filter((p) => {
        const t = Date.parse(p.time);
        return t >= from && t <= to;
      }),
      models: basis?.models ?? [],
      computedAt: latest?.computedAt ?? null,
      dataAgeH: this.dataAgeH(basis, nowMs),
      mc0Source: latest?.mc0Source ?? null,
      mc0At: latest?.mc0At ?? null,
      modelVersion: latest?.modelVersion ?? null,
    };
  }

  // ── harvest events ─────────────────────────────────────────────────────────

  /** Link readings taken around/after the harvest that no clock owns yet. */
  private async linkReadings(
    orgId: string,
    parcelId: string,
    eventId: string,
    harvestedAtIso: string,
  ): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_moisture_readings
      SET harvest_event_id = ${eventId}::uuid
      WHERE organization_id = ${orgId}::uuid AND parcel_id = ${parcelId}::uuid
        AND harvest_event_id IS NULL AND deleted_at IS NULL
        AND measured_at >= ${harvestedAtIso}::timestamptz - interval '12 hours'
    `);
  }

  async createHarvestEvent(
    orgId: string,
    userId: string,
    dto: CreateHarvestEventDto,
  ): Promise<MeteoHarvestEvent> {
    await this.access.assertOptedIn(orgId);
    const db = this.drizzleProvider.db;
    const parcel = (await db.execute(sql`
      SELECT id FROM parcels
      WHERE id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as unknown[];
    if (parcel.length === 0) throw new NotFoundException('Parcel not found');

    const harvestedAt = new Date(Math.min(Date.parse(dto.harvestedAt), Date.now())).toISOString();
    let rows: MeteoHarvestEvent[];
    try {
      rows = (await db.execute(sql`
        INSERT INTO meteo_harvest_events
          (organization_id, parcel_id, harvested_at, harvested_at_basis, crop_type, swath_type, created_by)
        VALUES (
          ${orgId}::uuid, ${dto.parcelId}::uuid, ${harvestedAt}::timestamptz,
          ${dto.fromAuditHint ? 'audit_hint_confirmed' : 'manual'},
          (SELECT crop_type::text FROM parcels WHERE id = ${dto.parcelId}::uuid),
          ${dto.swathType ?? 'wide'}, ${userId}::uuid
        )
        RETURNING ${EVENT_COLS}
      `)) as unknown as MeteoHarvestEvent[];
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'HARVEST_EVENT_OPEN',
          message: 'Această parcelă are deja un ceas de uscare deschis.',
        });
      }
      throw err;
    }
    const event = rows[0];
    await this.linkReadings(orgId, dto.parcelId, event.id, harvestedAt);
    this.winston.log('flow', 'Meteo harvest event created', {
      context: 'MeteoService',
      orgId,
      eventId: event.id,
      parcelId: dto.parcelId,
      basis: event.harvestedAtBasis,
    });
    await this.data.enqueueIngestForEvent(event.id);
    await this.data.enqueueEngine(event.id);
    return event;
  }

  async updateHarvestEvent(
    orgId: string,
    id: string,
    dto: UpdateHarvestEventDto,
  ): Promise<MeteoHarvestEvent> {
    await this.access.assertOptedIn(orgId);
    const harvestedAt = dto.harvestedAt
      ? new Date(Math.min(Date.parse(dto.harvestedAt), Date.now())).toISOString()
      : null;
    const rows = (await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_harvest_events
      SET harvested_at = COALESCE(${harvestedAt}::timestamptz, harvested_at),
          swath_type = COALESCE(${dto.swathType ?? null}, swath_type)
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid
        AND closed_at IS NULL AND deleted_at IS NULL
      RETURNING ${EVENT_COLS}
    `)) as unknown as MeteoHarvestEvent[];
    const event = rows[0];
    if (!event) throw new NotFoundException('Open harvest event not found');
    if (harvestedAt) {
      await this.linkReadings(orgId, event.parcelId, event.id, event.harvestedAt);
      // Moving the start back needs more history than the cell may hold.
      await this.data.enqueueIngestForEvent(event.id);
    }
    await this.data.enqueueEngine(event.id);
    this.winston.log('flow', 'Meteo harvest event updated', {
      context: 'MeteoService',
      orgId,
      eventId: id,
    });
    return event;
  }

  async closeHarvestEvent(orgId: string, id: string): Promise<MeteoHarvestEvent> {
    await this.access.assertOptedIn(orgId);
    const rows = (await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_harvest_events
      SET closed_at = now(), close_reason = 'manual'
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid
        AND closed_at IS NULL AND deleted_at IS NULL
      RETURNING ${EVENT_COLS}
    `)) as unknown as MeteoHarvestEvent[];
    if (!rows[0]) throw new NotFoundException('Open harvest event not found');
    this.winston.log('flow', 'Meteo harvest event closed manually', {
      context: 'MeteoService',
      orgId,
      eventId: id,
    });
    return rows[0];
  }

  // ── readings ───────────────────────────────────────────────────────────────

  async listReadings(orgId: string, parcelId: string): Promise<MeteoMoistureReading[]> {
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT ${READING_COLS}
      FROM meteo_moisture_readings
      WHERE organization_id = ${orgId}::uuid AND parcel_id = ${parcelId}::uuid AND deleted_at IS NULL
      ORDER BY measured_at DESC
      LIMIT 500
    `);
    return rows as unknown as MeteoMoistureReading[];
  }

  async createReading(
    orgId: string,
    userId: string,
    dto: CreateMoistureReadingDto,
  ): Promise<MeteoMoistureReading> {
    await this.access.assertOptedIn(orgId);
    const db = this.drizzleProvider.db;

    const parcel = (await db.execute(sql`
      SELECT id FROM parcels
      WHERE id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as unknown[];
    if (parcel.length === 0) throw new BadRequestException('Parcel not found in this organization');

    if (dto.baleProductionId) {
      const bp = (await db.execute(sql`
        SELECT id FROM bale_productions
        WHERE id = ${dto.baleProductionId}::uuid AND organization_id = ${orgId}::uuid
          AND parcel_id = ${dto.parcelId}::uuid AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as unknown[];
      if (bp.length === 0) {
        throw new BadRequestException('baleProductionId does not belong to this parcel');
      }
    }

    // A phone clock may run fast: never store a measurement from the future.
    const measuredMs = Math.min(Date.parse(dto.measuredAt), Date.now());
    await this.seasons.assertSeasonWritable(orgId, new Date(measuredMs));

    // moisture_wb is NUMERIC(5,4); the wire value is percent.
    const moistureWb = Math.round(dto.moisturePct * 100) / 10000;
    if (!(moistureWb > 0 && moistureWb < 1))
      throw new BadRequestException('moisturePct out of range');

    const rows = (await db.execute(sql`
      INSERT INTO meteo_moisture_readings (
        id, organization_id, parcel_id, harvest_event_id, measured_at, moisture_wb, kind,
        bale_production_id, lat, lon, source, created_by
      ) VALUES (
        ${dto.id}::uuid, ${orgId}::uuid, ${dto.parcelId}::uuid,
        (SELECT id FROM meteo_harvest_events
          WHERE parcel_id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid
            AND closed_at IS NULL AND deleted_at IS NULL
          LIMIT 1),
        ${new Date(measuredMs).toISOString()}::timestamptz, ${moistureWb}, ${dto.kind},
        ${dto.baleProductionId ?? null}::uuid, ${dto.lat ?? null}, ${dto.lon ?? null}, ${dto.source},
        ${userId}::uuid
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING ${READING_COLS}
    `)) as unknown as MeteoMoistureReading[];

    const reading = rows[0];
    if (!reading) {
      // Idempotent replay: mobile treats 409 as "already stored".
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'READING_EXISTS',
        message: 'Măsurătoarea există deja.',
      });
    }
    this.winston.log('flow', 'Meteo moisture reading recorded', {
      context: 'MeteoService',
      orgId,
      readingId: reading.id,
      parcelId: dto.parcelId,
      kind: dto.kind,
      source: dto.source,
    });
    if (reading.harvestEventId) await this.data.enqueueEngine(reading.harvestEventId);
    return reading;
  }

  async deleteReading(orgId: string, id: string): Promise<{ id: string }> {
    await this.access.assertOptedIn(orgId);
    const rows = (await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_moisture_readings
      SET deleted_at = now()
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL
      RETURNING harvest_event_id::text AS "harvestEventId"
    `)) as unknown as Array<{ harvestEventId: string | null }>;
    if (!rows[0]) throw new NotFoundException('Reading not found');
    if (rows[0].harvestEventId) await this.data.enqueueEngine(rows[0].harvestEventId);
    this.winston.log('flow', 'Meteo moisture reading deleted', {
      context: 'MeteoService',
      orgId,
      readingId: id,
    });
    return { id };
  }

  // ── fingerprints ───────────────────────────────────────────────────────────

  private async queryFingerprints(
    orgId: string,
    opts: { parcelId?: string; baleProductionId?: string },
  ): Promise<Array<MeteoBaleFingerprint & { snapshotCanonical: string }>> {
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT
        f.bale_production_id::text AS "baleProductionId", f.parcel_id::text AS "parcelId",
        f.harvest_event_id::text AS "harvestEventId", ${isoSql(sql`f.baled_at`)} AS "baledAt",
        f.baled_at_basis AS "baledAtBasis", f.window_status AS "windowStatus",
        f.run_status_at_compute AS "runStatusAtCompute",
        f.rain_since_harvest_mm::float8 AS "rainSinceHarvestMm", f.drying_hours::float8 AS "dryingHours",
        f.mc_p10::float8 AS "mcP10", f.mc_p50::float8 AS "mcP50", f.mc_p90::float8 AS "mcP90",
        f.mc_measured::float8 AS "mcMeasured",
        f.model_version AS "modelVersion", f.attribution, f.sha256, ${isoSql(sql`f.frozen_at`)} AS "frozenAt",
        encode(sha256(convert_to(f.snapshot_canonical, 'UTF8')), 'hex') = f.sha256 AS "hashValid",
        CASE
          WHEN bp.deleted_at IS NOT NULL THEN 'deleted'
          WHEN bp.parcel_id <> f.parcel_id
            -- baled_at is frozen at millisecond precision (ISO text round-trip);
            -- bale_productions times come from now() with microseconds.
            OR date_trunc('milliseconds', ${BP_BALED_AT}) IS DISTINCT FROM date_trunc('milliseconds', f.baled_at)
            OR bp.bale_count IS DISTINCT FROM (f.snapshot_canonical::jsonb #>> '{baleProduction,baleCount}')::int
          THEN 'modified'
          ELSE 'ok'
        END AS "sourceStatus",
        (f.snapshot_canonical::jsonb #>> '{baleProduction,baleCount}')::int AS "baleCount",
        f.snapshot_canonical AS "snapshotCanonical"
      FROM meteo_bale_fingerprints f
      JOIN bale_productions bp ON bp.id = f.bale_production_id
      WHERE f.organization_id = ${orgId}::uuid
        ${opts.parcelId ? sql`AND f.parcel_id = ${opts.parcelId}::uuid` : sql``}
        ${opts.baleProductionId ? sql`AND f.bale_production_id = ${opts.baleProductionId}::uuid` : sql`AND bp.deleted_at IS NULL`}
      ORDER BY f.baled_at DESC
      LIMIT ${opts.baleProductionId ? 1 : 200}
    `);
    return rows as unknown as Array<MeteoBaleFingerprint & { snapshotCanonical: string }>;
  }

  /** Deleted sources are excluded; the heavy canonical text is not returned. */
  async listFingerprints(orgId: string, parcelId?: string): Promise<MeteoBaleFingerprint[]> {
    const rows = await this.queryFingerprints(orgId, { parcelId });
    return rows.map(({ snapshotCanonical: _omit, ...rest }) => rest);
  }

  async getFingerprint(orgId: string, baleProductionId: string): Promise<MeteoBaleFingerprint> {
    const rows = await this.queryFingerprints(orgId, { baleProductionId });
    if (!rows[0]) throw new NotFoundException('Fingerprint not found');
    return rows[0];
  }

  // ── recompute ──────────────────────────────────────────────────────────────

  async recompute(orgId: string): Promise<{ queued: number }> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT id::text AS id FROM meteo_harvest_events
      WHERE organization_id = ${orgId}::uuid AND closed_at IS NULL AND deleted_at IS NULL
      LIMIT 500
    `)) as unknown as Array<{ id: string }>;
    for (const r of rows) await this.data.enqueueEngine(r.id);
    return { queued: rows.length };
  }
}
