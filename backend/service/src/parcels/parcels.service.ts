import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { HarvestStatus } from '@strawboss/types';
import type { ParcelImportResult } from '@strawboss/types';

/**
 * Events that drive a parcel forward on the harvest ladder once trip /
 * loading lifecycle moves on. Triggered by Plan C from trips / bale-loads.
 */
export type HarvestLoadEvent =
  | 'loading_started' // first bale_load row inserted for this parcel today
  | 'all_loaded' // produced - loaded === 0 for this parcel
  | 'all_delivered'; // all trips carrying this parcel reached `completed`

const PG_CHECK_VIOLATION = '23514';
const PG_UNIQUE_VIOLATION = '23505';
const PG_INVALID_GEOMETRY = '22023';

/**
 * Translate a Postgres / PostGIS error into a short, client-safe message for
 * the per-row `errors[]` array returned by bulk KML import. The full original
 * error is still logged via Winston — we just never echo Postgres internals
 * (constraint names, column names, PostGIS prefixes) back over HTTP.
 */
function sanitizeImportError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === PG_UNIQUE_VIOLATION) return 'A parcel with this code already exists';
  if (code === PG_INVALID_GEOMETRY) return 'Invalid boundary geometry';
  const raw = err instanceof Error ? err.message : String(err);
  if (/ST_|GeoJSON|geometry/i.test(raw)) return 'Invalid boundary geometry';
  return 'Import failed for this row';
}

@Injectable()
export class ParcelsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {}

  async list(
    orgId: string | null,
    filters?: { municipality?: string; isActive?: boolean; cropType?: string },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.municipality) {
      conditions.push(sql`municipality = ${filters.municipality}`);
    }
    // T9.2 — isActive filter accepted for backward-compat but ignored: all
    // non-soft-deleted parcels are now considered active.
    if (filters?.cropType) {
      conditions.push(sql`crop_type = ${filters.cropType}::crop_type`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        id, code, name,

        area_hectares       AS "areaHectares",
        ST_AsGeoJSON(boundary)::json  AS boundary,
        ST_AsGeoJSON(centroid)::json  AS centroid,
        address, municipality,
        farmtrack_geofence_id AS "farmtrackGeofenceId",
        farm_id             AS "farmId",
        notes,
        is_active           AS "isActive",
        harvest_status      AS "harvestStatus",
        crop_type           AS "cropType",
        created_at          AS "createdAt",
        updated_at          AS "updatedAt",
        deleted_at          AS "deletedAt"
      FROM parcels
      WHERE ${where}
      ORDER BY code ASC NULLS LAST
    `);
    return result;
  }

  async getBaleAvailability(id: string, orgId: string | null) {
    // Ownership check — throws NotFoundException if parcel doesn't exist or belongs to another org
    await this.findById(id, orgId);

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(bale_count) FROM bale_productions WHERE parcel_id = ${id} AND deleted_at IS NULL), 0) AS "produced",
        COALESCE((SELECT SUM(bale_count) FROM bale_loads WHERE parcel_id = ${id} AND deleted_at IS NULL), 0) AS "loaded"
    `);
    const rows = result as unknown as Array<{ produced: number; loaded: number }>;
    const { produced, loaded } = rows[0];
    const remaining = Number(produced) - Number(loaded);
    return { produced: Number(produced), loaded: Number(loaded), remaining };
  }

  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        id, code, name,

        area_hectares       AS "areaHectares",
        ST_AsGeoJSON(boundary)::json  AS boundary,
        ST_AsGeoJSON(centroid)::json  AS centroid,
        address, municipality,
        farmtrack_geofence_id AS "farmtrackGeofenceId",
        farm_id             AS "farmId",
        notes,
        is_active           AS "isActive",
        harvest_status      AS "harvestStatus",
        crop_type           AS "cropType",
        created_at          AS "createdAt",
        updated_at          AS "updatedAt",
        deleted_at          AS "deletedAt"
      FROM parcels
      WHERE ${where}
      LIMIT 1
    `);
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Parcel ${id} not found`);
    }
    return rows[0];
  }

  /**
   * Resolve the municipality name via Nominatim reverse geocoding.
   * Returns null if the lookup fails or times out.
   */
  private async reverseLookupMunicipality(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'StrawBoss/1.0 (contact@strawboss.app)' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        address?: {
          municipality?: string;
          city?: string;
          town?: string;
          village?: string;
          county?: string;
        };
      };
      return (
        data.address?.municipality ??
        data.address?.city ??
        data.address?.town ??
        data.address?.village ??
        data.address?.county ??
        null
      );
    } catch {
      return null;
    }
  }

  async create(orgId: string | null, dto: Record<string, unknown>) {
    const toGeoJsonFragment = (val: unknown) =>
      val
        ? sql`ST_GeomFromGeoJSON(${typeof val === 'string' ? val : JSON.stringify(val)})`
        : sql`NULL`;

    // ── Auto-generate code if not supplied ──────────────────────────────
    let code = (dto.code as string | undefined) ?? null;
    if (!code) {
      const seqRow = await this.drizzleProvider.db.execute(
        sql`SELECT 'P-' || LPAD(nextval('parcels_code_seq')::text, 4, '0') AS code`,
      );
      code = (seqRow as unknown as Array<{ code: string }>)[0].code;
    }

    // ── Compute area and centroid from boundary (PostGIS) ────────────────
    const { areaHectares, centroidGeoJson } = await this.computeGeo(
      dto.boundary,
      (dto.areaHectares as number | undefined) ?? null,
    );

    // ── Reverse geocode municipality from centroid (single-create only) ──
    let municipality = (dto.municipality as string | undefined) ?? null;
    if (municipality === null && centroidGeoJson) {
      const centroid = JSON.parse(centroidGeoJson) as {
        type: string;
        coordinates: [number, number];
      };
      // GeoJSON coordinates are [lon, lat]
      const [lon, lat] = centroid.coordinates;
      municipality = await this.reverseLookupMunicipality(lat, lon);
    }

    // Prefer explicitly provided centroid, fall back to computed one.
    const centroidInput = dto.centroid ?? (centroidGeoJson ? JSON.parse(centroidGeoJson) : null);

    const harvestStatus = (dto.harvestStatus as string | undefined) ?? 'planned';

    const cropType = (dto.cropType as string | null | undefined) ?? null;

    const result = await this.drizzleProvider.db.execute(sql`
      INSERT INTO parcels (
        organization_id,
        code, name, area_hectares,
        boundary, centroid, address, municipality,
        farmtrack_geofence_id, farm_id, notes, is_active, harvest_status, crop_type
      ) VALUES (
        ${orgId}::uuid,
        ${code},
        ${(dto.name as string) ?? null},
        ${areaHectares},
        ${toGeoJsonFragment(dto.boundary)},
        ${toGeoJsonFragment(centroidInput)},
        ${(dto.address as string) ?? null},
        ${municipality},
        ${(dto.farmtrackGeofenceId as string) ?? null},
        ${(dto.farmId as string) ?? null},
        ${(dto.notes as string) ?? null},
        true,
        ${harvestStatus}::harvest_status,
        ${cropType === null ? sql`NULL` : sql`${cropType}::crop_type`}
      )
      RETURNING
        id, code, name,
        area_hectares AS "areaHectares",
        ST_AsGeoJSON(boundary)::json AS boundary,
        ST_AsGeoJSON(centroid)::json AS centroid,
        address, municipality,
        farmtrack_geofence_id AS "farmtrackGeofenceId",
        farm_id AS "farmId",
        notes, is_active AS "isActive",
        harvest_status AS "harvestStatus",
        crop_type AS "cropType",
        created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
    `);
    return result;
  }

  /**
   * Compute parcel area (hectares) and centroid (GeoJSON) from a boundary.
   * Declared area wins when supplied; otherwise the geometric area (UTM 34N)
   * is used. Does NOT reverse-geocode — callers decide whether to (single
   * create does; bulk import skips it to avoid hammering Nominatim).
   */
  private async computeGeo(
    boundary: unknown,
    declaredHa: number | null,
  ): Promise<{ areaHectares: number | null; centroidGeoJson: string | null }> {
    let areaHectares = declaredHa;
    let centroidGeoJson: string | null = null;

    if (boundary) {
      const boundaryStr = typeof boundary === 'string' ? boundary : JSON.stringify(boundary);

      const geoCalcRow = await this.drizzleProvider.db.execute(sql`
        SELECT
          ROUND(
            (ST_Area(ST_Transform(ST_GeomFromGeoJSON(${boundaryStr}), 32634)) / 10000.0)::numeric,
            2
          ) AS area_ha,
          ST_AsGeoJSON(ST_Centroid(ST_GeomFromGeoJSON(${boundaryStr}))) AS centroid_geojson
      `);

      const calcResult = (
        geoCalcRow as unknown as Array<{ area_ha: string; centroid_geojson: string }>
      )[0];

      if (areaHectares === null && calcResult?.area_ha) {
        areaHectares = parseFloat(calcResult.area_ha);
      }
      if (calcResult?.centroid_geojson) {
        centroidGeoJson = calcResult.centroid_geojson;
      }
    }

    return { areaHectares, centroidGeoJson };
  }

  /**
   * Bulk-import parsed KML parcels. Upserts on `(code, organization_id)` so
   * re-importing the same file updates geometry/area/notes/farm rather than
   * creating duplicates. Admin-set `crop_type` and workflow `harvest_status`
   * are preserved on update; admin-edited `notes` are never destroyed (only
   * filled/refreshed when the KML carries a value). A conflicting row that is
   * soft-deleted is left untouched and counted as `skipped` — resurrection
   * stays an explicit admin action, not a side effect of import. Each row is
   * independent: one bad geometry is reported as a failure without aborting
   * the rest.
   */
  async importMany(
    orgId: string | null,
    dto: { farmId?: string | null; parcels: Array<Record<string, unknown>> },
  ): Promise<ParcelImportResult> {
    // super_admin (orgId === null) has no tenant to scope rows to; the
    // organization_id column is NOT NULL, so every row would fail. Reject up
    // front with a clear error instead of returning all-failed.
    if (orgId === null) {
      throw new BadRequestException(
        'A super_admin must act within an organization to import parcels.',
      );
    }

    const farmId = (dto.farmId as string | null | undefined) ?? null;
    const parcels = Array.isArray(dto.parcels) ? dto.parcels : [];

    // Ensure the target farm belongs to the caller's organization — never let a
    // request link parcels to another tenant's farm (the FK only checks existence).
    if (farmId !== null) {
      const farmRow = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM farms
        WHERE id = ${farmId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL
        LIMIT 1
      `);
      if ((farmRow as unknown as unknown[]).length === 0) {
        throw new NotFoundException(`Farm ${farmId} not found`);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { code: string; message: string }[] = [];

    const toGeoJsonFragment = (val: unknown) =>
      val
        ? sql`ST_GeomFromGeoJSON(${typeof val === 'string' ? val : JSON.stringify(val)})`
        : sql`NULL`;

    for (const p of parcels) {
      const code = (p.code as string | undefined) ?? '';
      const notes = (p.notes as string | null | undefined) ?? null;
      try {
        // Look up the current state of this code within the org. This drives an
        // explicit insert/update/skip decision — clearer and more robust than
        // inferring it from xmax on an ON CONFLICT RETURNING. Imports are a
        // low-frequency admin action, so the extra SELECT is negligible.
        const existingRows = await this.drizzleProvider.db.execute(sql`
          SELECT deleted_at FROM parcels
          WHERE code = ${code} AND organization_id = ${orgId}::uuid
          LIMIT 1
        `);
        const existing = (existingRows as unknown as Array<{ deleted_at: string | null }>)[0];

        // A soft-deleted parcel is left untouched: resurrection stays an
        // explicit admin action, not a side effect of re-import.
        if (existing && existing.deleted_at !== null) {
          skipped += 1;
          continue;
        }

        const { areaHectares, centroidGeoJson } = await this.computeGeo(
          p.boundary,
          (p.areaHectares as number | undefined) ?? null,
        );
        const centroidInput = centroidGeoJson ? JSON.parse(centroidGeoJson) : null;

        if (existing) {
          // Live row → update geometry/area/farm; never destroy admin-edited
          // notes (COALESCE), preserve the existing farm assignment when the
          // request omits farmId (COALESCE), and leave crop_type /
          // harvest_status untouched. RETURNING id lets us only count rows we
          // actually touched — if a concurrent soft-delete slips in between
          // the SELECT above and this UPDATE, the row is gone and we skip.
          const updatedRows = await this.drizzleProvider.db.execute(sql`
            UPDATE parcels SET
              boundary      = ${toGeoJsonFragment(p.boundary)},
              centroid      = ${toGeoJsonFragment(centroidInput)},
              area_hectares = ${areaHectares},
              notes         = COALESCE(${notes}, notes),
              farm_id       = COALESCE(${farmId}, farm_id),
              updated_at    = now()
            WHERE code = ${code} AND organization_id = ${orgId}::uuid AND deleted_at IS NULL
            RETURNING id
          `);
          if ((updatedRows as unknown as unknown[]).length > 0) {
            updated += 1;
          } else {
            skipped += 1;
          }
        } else {
          await this.drizzleProvider.db.execute(sql`
            INSERT INTO parcels (
              organization_id, code, name, area_hectares,
              boundary, centroid, notes, farm_id, is_active, harvest_status
            ) VALUES (
              ${orgId}::uuid,
              ${code},
              ${(p.name as string | undefined) ?? code},
              ${areaHectares},
              ${toGeoJsonFragment(p.boundary)},
              ${toGeoJsonFragment(centroidInput)},
              ${notes},
              ${farmId},
              true,
              'planned'::harvest_status
            )
          `);
          created += 1;
        }
      } catch (err) {
        failed += 1;
        const rawMessage = err instanceof Error ? err.message : String(err);
        errors.push({ code: code || '(unnamed)', message: sanitizeImportError(err) });
        this.winston.warn('KML parcel import row failed', {
          context: 'ParcelsService',
          code,
          message: rawMessage,
        });
      }
    }

    this.winston.info('KML parcel import finished', {
      context: 'ParcelsService',
      orgId,
      farmId,
      total: parcels.length,
      created,
      updated,
      skipped,
      failed,
    });

    return { total: parcels.length, created, updated, skipped, failed, errors };
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId);

    const setClauses: ReturnType<typeof sql>[] = [];
    // T9.2 — `isActive` intentionally NOT in fieldMap. Silently ignored.
    const fieldMap: Record<string, string> = {
      code: 'code',
      name: 'name',
      areaHectares: 'area_hectares',
      boundary: 'boundary',
      centroid: 'centroid',
      address: 'address',
      municipality: 'municipality',
      farmtrackGeofenceId: 'farmtrack_geofence_id',
      farmId: 'farm_id',
      notes: 'notes',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        // GeoJSON geometry fields must be stored via ST_GeomFromGeoJSON.
        if ((key === 'boundary' || key === 'centroid') && dto[key]) {
          const geoJsonStr =
            typeof dto[key] === 'string' ? (dto[key] as string) : JSON.stringify(dto[key]);
          setClauses.push(sql`${sql.raw(column)} = ST_GeomFromGeoJSON(${geoJsonStr})`);
        } else {
          const value = dto[key];
          setClauses.push(sql`${sql.raw(column)} = ${value as string | number | boolean | null}`);
        }
      }
    }

    // When the boundary geometry changes (e.g. an admin drags a vertex), keep the
    // derived centroid + area in sync unless the caller passed them explicitly —
    // otherwise the map pin / mobile "navigate to field" target and the displayed
    // hectares would drift from the new shape.
    if ('boundary' in dto && dto.boundary) {
      const { areaHectares, centroidGeoJson } = await this.computeGeo(
        dto.boundary,
        'areaHectares' in dto ? ((dto.areaHectares as number | null) ?? null) : null,
      );
      if (!('centroid' in dto) && centroidGeoJson) {
        setClauses.push(sql`centroid = ST_GeomFromGeoJSON(${centroidGeoJson})`);
      }
      if (!('areaHectares' in dto) && areaHectares != null) {
        setClauses.push(sql`area_hectares = ${areaHectares}`);
      }
    }

    if ('harvestStatus' in dto && dto.harvestStatus != null) {
      setClauses.push(sql`harvest_status = ${dto.harvestStatus as string}::harvest_status`);
    }

    if ('cropType' in dto) {
      const v = dto.cropType;
      setClauses.push(
        v == null ? sql`crop_type = NULL` : sql`crop_type = ${v as string}::crop_type`,
      );
    }

    if (setClauses.length === 0) {
      return this.findById(id, orgId);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const updateConditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    const updateWhere = sql.join(updateConditions, sql` AND `);

    try {
      await this.drizzleProvider.db.execute(
        sql`UPDATE parcels SET ${setClause} WHERE ${updateWhere}`,
      );
    } catch (err) {
      // T7 — DB trigger raises check_violation on harvest_status downgrade.
      // Surface as 409 with a localized message instead of leaking the raw SQL.
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode === PG_CHECK_VIOLATION) {
        this.winston.warn('Parcel harvest_status downgrade refused', {
          context: 'ParcelsService',
          parcelId: id,
          dto,
        });
        throw new ConflictException(
          'Statusul recoltei nu poate fi retrogradat. Utilizați bypass-ul admin doar pentru corecții de date.',
        );
      }
      throw err;
    }
    return this.findById(id, orgId);
  }

  /**
   * When daily planning marks a parcel done / not done, mirror that into
   * parcels.harvest_status: done → harvested; not done → to_harvest.
   *
   * Wrapped in try/catch on check_violation (23514) so a stale daily-plan
   * toggle on an already-loaded parcel does not crash the request — it just
   * warns and proceeds. T7.
   */
  async applyHarvestStatusFromDailyPlan(parcelId: string, isDone: boolean, orgId: string | null) {
    const status = isDone ? 'harvested' : 'to_harvest';
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${parcelId}`, sql`deleted_at IS NULL`];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    try {
      await this.drizzleProvider.db.execute(sql`
        UPDATE parcels
        SET harvest_status = ${status}::harvest_status, updated_at = NOW()
        WHERE ${where}
      `);
    } catch (err) {
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode === PG_CHECK_VIOLATION) {
        this.winston.warn(
          'applyHarvestStatusFromDailyPlan blocked by downgrade trigger — ignoring',
          { context: 'ParcelsService', parcelId, isDone, targetStatus: status },
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Advance a parcel's harvest_status based on a trip-lifecycle event from
   * Plan C. Idempotent: silently no-ops if the target rank is <= current
   * rank (downgrade-prevented at DB level too).
   *
   * State map:
   *   loading_started : harvested | partial_harvested -> in_loading
   *   all_loaded      : in_loading                   -> loaded
   *   all_delivered   : loaded                       -> completed
   *
   * Returns { updated, fromStatus, toStatus } so callers can decide whether
   * to notify.
   */
  async advanceHarvestOnLoadEvent(
    parcelId: string,
    event: HarvestLoadEvent,
    orgId: string | null,
  ): Promise<{
    updated: boolean;
    fromStatus: HarvestStatus;
    toStatus: HarvestStatus;
  }> {
    const targetMap: Record<HarvestLoadEvent, HarvestStatus> = {
      loading_started: HarvestStatus.in_loading,
      all_loaded: HarvestStatus.loaded,
      all_delivered: HarvestStatus.completed,
    };
    const target = targetMap[event];

    const current = await this.findById(parcelId, orgId);
    const from = current.harvestStatus as HarvestStatus;

    // Use the DB rank function so client + server agree on ordering.
    const rankResult = (await this.drizzleProvider.db.execute(sql`
      SELECT
        harvest_status_rank(${from}::harvest_status)   AS "fromRank",
        harvest_status_rank(${target}::harvest_status) AS "toRank"
    `)) as unknown as Array<{ fromRank: number; toRank: number }>;
    const { fromRank, toRank } = rankResult[0];
    if (toRank <= fromRank) {
      this.winston.info('advanceHarvestOnLoadEvent: no-op (rank not increased)', {
        context: 'ParcelsService',
        parcelId,
        event,
        fromStatus: from,
        toStatus: target,
      });
      return { updated: false, fromStatus: from, toStatus: from };
    }

    const conds: ReturnType<typeof sql>[] = [sql`id = ${parcelId}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) conds.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conds, sql` AND `);

    try {
      await this.drizzleProvider.db.execute(sql`
        UPDATE parcels
        SET harvest_status = ${target}::harvest_status, updated_at = NOW()
        WHERE ${where}
      `);
    } catch (err) {
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode === PG_CHECK_VIOLATION) {
        // Defensive: rank check above already ruled this out, but if the
        // DB races (concurrent update) just log and report no change.
        this.winston.warn('advanceHarvestOnLoadEvent: downgrade trigger fired despite rank guard', {
          context: 'ParcelsService',
          parcelId,
          event,
          fromStatus: from,
          target,
        });
        return { updated: false, fromStatus: from, toStatus: from };
      }
      throw err;
    }

    this.winston.info('parcels.harvest.advance', {
      context: 'ParcelsService',
      kind: 'flow',
      parcelId,
      event,
      fromStatus: from,
      toStatus: target,
    });

    return { updated: true, fromStatus: from, toStatus: target };
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);

    const deleteConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) deleteConditions.push(sql`organization_id = ${orgId}::uuid`);
    const deleteWhere = sql.join(deleteConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE parcels SET deleted_at = NOW(), updated_at = NOW() WHERE ${deleteWhere} RETURNING *`,
    );
    return result;
  }
}
