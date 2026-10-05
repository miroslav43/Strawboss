import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import {
  buildFingerprint,
  canonicalJson,
  deriveStatus,
  requiredHoursFor,
  type BaledAtBasis,
  type SnapshotPoint,
} from '@strawboss/domain';
import {
  METEO_ATTRIBUTION,
  type MeteoDerivedStatus,
  type MeteoOrgSettings,
  type MeteoReason,
  type SwathType,
} from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { MeteoAccessService, meteoJobsEnabled } from './meteo-access.service';
import { asJson, epochMsSql, isoSql } from './meteo-data.service';
import {
  FINGERPRINT_LOOKBACK_DAYS,
  FINGERPRINT_READING_WINDOW_H,
  METEO_MODEL_VERSION,
} from './meteo.constants';
import { QUEUE_METEO_FINGERPRINT } from './meteo.queues';

const BATCH = 200;

interface Candidate {
  bpId: string;
  orgId: string;
  parcelId: string;
  baleCount: number;
  productionDate: string;
  startTime: string | null;
  endTime: string | null;
  baledAtMs: number;
  baledAt: string;
  baledAtBasis: BaledAtBasis;
  eventId: string;
  eventHarvestedAt: string;
  swathType: SwathType;
  areaHa: number | null;
}

interface SnapshotRow {
  id: string;
  computedAtMs: number;
  computedAt: string;
  basis: unknown;
  hourly: unknown;
  modelVersion: string;
}

/**
 * Freezes the weather picture of every bale_productions row once: what the
 * latest engine run computed BEFORE the baling knew about the parcel. Rows are
 * inserted with ON CONFLICT DO NOTHING and are immutable afterwards.
 */
@Injectable()
@Processor(QUEUE_METEO_FINGERPRINT)
export class MeteoFingerprintProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!meteoJobsEnabled()) return;
    const candidates = await this.findCandidates();
    const orgOk = new Map<string, boolean>();
    const settingsByOrg = new Map<string, MeteoOrgSettings>();
    let created = 0;

    for (const c of candidates) {
      try {
        if (!orgOk.has(c.orgId)) {
          orgOk.set(c.orgId, await this.access.isActiveForOrg(c.orgId, 'meteo.fingerprint'));
        }
        if (!orgOk.get(c.orgId)) continue;
        let settings = settingsByOrg.get(c.orgId);
        if (!settings) {
          settings = await this.access.getSettings(c.orgId);
          settingsByOrg.set(c.orgId, settings);
        }
        if (await this.freeze(c, settings)) created++;
      } catch (err) {
        this.winston.error('Meteo fingerprint failed', {
          context: 'MeteoFingerprintProcessor',
          baleProductionId: c.bpId,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
      }
    }
    if (created > 0) {
      this.winston.log('flow', 'Meteo fingerprints created', {
        context: 'MeteoFingerprintProcessor',
        jobId: job.id,
        created,
      });
    }
  }

  /**
   * Recent, live bale_productions of opted-in orgs with no fingerprint yet and
   * a drying clock (any state) that started at or before baled_at. baled_at is
   * computed in SQL, with its provenance.
   */
  private async findCandidates(): Promise<Candidate[]> {
    const rows = await this.drizzleProvider.db.execute(sql`
      WITH cand AS (
        SELECT
          bp.id, bp.organization_id, bp.parcel_id, bp.bale_count, bp.production_date,
          bp.start_time, bp.end_time, bp.created_at,
          COALESCE(bp.end_time, bp.start_time,
                   (bp.production_date + time '12:00') AT TIME ZONE 'Europe/Bucharest') AS baled_at,
          CASE
            WHEN bp.end_time IS NOT NULL THEN 'end_time'
            WHEN bp.start_time IS NOT NULL THEN 'start_time'
            ELSE 'production_date_noon'
          END AS basis
        FROM bale_productions bp
        JOIN meteo_org_settings s ON s.organization_id = bp.organization_id AND s.enabled
        WHERE bp.created_at > now() - make_interval(days => ${FINGERPRINT_LOOKBACK_DAYS})
          AND bp.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM meteo_bale_fingerprints f WHERE f.bale_production_id = bp.id)
      )
      SELECT
        c.id::text AS "bpId", c.organization_id::text AS "orgId", c.parcel_id::text AS "parcelId",
        c.bale_count AS "baleCount", to_char(c.production_date, 'YYYY-MM-DD') AS "productionDate",
        ${isoSql(sql`c.start_time`)} AS "startTime", ${isoSql(sql`c.end_time`)} AS "endTime",
        ${epochMsSql(sql`c.baled_at`)} AS "baledAtMs", ${isoSql(sql`c.baled_at`)} AS "baledAt",
        c.basis AS "baledAtBasis",
        ev.id::text AS "eventId", ${isoSql(sql`ev.harvested_at`)} AS "eventHarvestedAt",
        ev.swath_type AS "swathType",
        COALESCE(p.area_hectares, ST_Area(p.boundary::geography) / 10000)::float8 AS "areaHa"
      FROM cand c
      JOIN LATERAL (
        SELECT e.id, e.harvested_at, e.swath_type
        FROM meteo_harvest_events e
        WHERE e.organization_id = c.organization_id AND e.parcel_id = c.parcel_id
          AND e.deleted_at IS NULL AND e.harvested_at <= c.baled_at
        ORDER BY e.harvested_at DESC
        LIMIT 1
      ) ev ON true
      JOIN parcels p ON p.id = c.parcel_id
      ORDER BY c.created_at
      LIMIT ${BATCH}
    `);
    return rows as unknown as Candidate[];
  }

  private async freeze(c: Candidate, settings: MeteoOrgSettings): Promise<boolean> {
    const db = this.drizzleProvider.db;
    const snapRows = (await db.execute(sql`
      SELECT id::text AS id, ${epochMsSql(sql`computed_at`)} AS "computedAtMs",
             ${isoSql(sql`computed_at`)} AS "computedAt", basis, hourly, model_version AS "modelVersion"
      FROM meteo_straw_snapshots
      WHERE harvest_event_id = ${c.eventId}::uuid
        AND organization_id = ${c.orgId}::uuid
        AND computed_at <= ${c.baledAt}::timestamptz
      ORDER BY computed_at DESC
      LIMIT 1
    `)) as unknown as SnapshotRow[];
    const snap = snapRows[0] ?? null;

    const basis = snap
      ? asJson<{
          models?: string[];
          newestIssuedAt?: string | null;
          blocking?: MeteoReason | null;
        }>(snap.basis)
      : null;
    const points = snap ? asJson<SnapshotPoint[]>(snap.hourly) : [];
    const requiredHours = requiredHoursFor(c.areaHa, settings.pressCapacityHaH);
    const common = {
      requiredHours,
      minWindowH: settings.minWindowH,
      areaHa: c.areaHa,
      baleableFracMin: settings.baleableFracMin,
      rainProbMax: settings.rainProbMax,
      newestIssuedAtMs: basis?.newestIssuedAt ? Date.parse(basis.newestIssuedAt) : null,
    };

    let derived: MeteoDerivedStatus;
    let runStatus: MeteoDerivedStatus | null = null;
    if (snap) {
      derived = deriveStatus(points, {
        ...common,
        atMs: c.baledAtMs,
        computedAtMs: snap.computedAtMs,
        blockingReason: basis?.blocking ?? null,
      });
      runStatus = deriveStatus(points, {
        ...common,
        atMs: snap.computedAtMs,
        computedAtMs: snap.computedAtMs,
        blockingReason: basis?.blocking ?? null,
      });
    } else {
      derived = deriveStatus([], {
        ...common,
        atMs: c.baledAtMs,
        computedAtMs: null,
        blockingReason: { key: 'noPriorForecast' },
      });
    }

    const measuredRows = (await db.execute(sql`
      SELECT id::text AS "readingId", moisture_wb::float8 AS "moistureWb", ${isoSql(sql`measured_at`)} AS "measuredAt"
      FROM meteo_moisture_readings
      WHERE organization_id = ${c.orgId}::uuid AND parcel_id = ${c.parcelId}::uuid
        AND deleted_at IS NULL AND kind = 'bale'
        AND (bale_production_id IS NULL OR bale_production_id = ${c.bpId}::uuid)
        AND (bale_production_id = ${c.bpId}::uuid
             OR measured_at BETWEEN ${c.baledAt}::timestamptz - make_interval(hours => ${FINGERPRINT_READING_WINDOW_H})
                                AND ${c.baledAt}::timestamptz + make_interval(hours => ${FINGERPRINT_READING_WINDOW_H}))
      ORDER BY (bale_production_id = ${c.bpId}::uuid) DESC NULLS LAST,
               abs(extract(epoch from measured_at - ${c.baledAt}::timestamptz))
      LIMIT 1
    `)) as unknown as Array<{ readingId: string; moistureWb: number; measuredAt: string }>;

    const built = buildFingerprint({
      baleProduction: {
        id: c.bpId,
        parcelId: c.parcelId,
        baleCount: c.baleCount,
        productionDate: c.productionDate,
        startTime: c.startTime,
        endTime: c.endTime,
      },
      baledAt: c.baledAt,
      baledAtBasis: c.baledAtBasis,
      harvestEvent: { id: c.eventId, harvestedAt: c.eventHarvestedAt, swathType: c.swathType },
      snapshot: snap
        ? {
            id: snap.id,
            computedAt: snap.computedAt,
            modelVersion: snap.modelVersion,
            models: basis?.models ?? [],
            points,
          }
        : null,
      settings: {
        thresholdWb: settings.thresholdWb,
        baleableFracMin: settings.baleableFracMin,
        rainProbMax: settings.rainProbMax,
        minWindowH: settings.minWindowH,
        pressCapacityHaH: settings.pressCapacityHaH,
      },
      derived,
      runStatusAtCompute: runStatus?.status ?? null,
      measured: measuredRows[0] ?? null,
      attribution: METEO_ATTRIBUTION,
    });

    const canonical = canonicalJson(built.payload);
    const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const res = await db.execute(sql`
      INSERT INTO meteo_bale_fingerprints (
        bale_production_id, organization_id, parcel_id, harvest_event_id, snapshot_id,
        baled_at, baled_at_basis, window_status, run_status_at_compute,
        rain_since_harvest_mm, drying_hours, mc_p10, mc_p50, mc_p90, mc_measured,
        snapshot_canonical, sha256, model_version, attribution
      ) VALUES (
        ${c.bpId}::uuid, ${c.orgId}::uuid, ${c.parcelId}::uuid, ${c.eventId}::uuid,
        ${snap ? sql`${snap.id}::uuid` : sql`NULL`},
        ${c.baledAt}::timestamptz, ${c.baledAtBasis}, ${built.windowStatus}, ${runStatus?.status ?? null},
        ${built.rainSinceHarvestMm}, ${built.dryingHours}, ${built.mcP10}, ${built.mcP50}, ${built.mcP90},
        ${built.mcMeasured},
        ${canonical}, ${sha256}, ${snap?.modelVersion ?? METEO_MODEL_VERSION}, ${METEO_ATTRIBUTION}
      )
      ON CONFLICT DO NOTHING
      RETURNING bale_production_id
    `);
    return res.length > 0;
  }
}
