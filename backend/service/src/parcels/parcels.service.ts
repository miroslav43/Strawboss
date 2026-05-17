import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class ParcelsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(orgId: string | null, filters?: { municipality?: string; isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.municipality) {
      conditions.push(sql`municipality = ${filters.municipality}`);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
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
        created_at          AS "createdAt",
        updated_at          AS "updatedAt",
        deleted_at          AS "deletedAt"
      FROM parcels
      WHERE ${where}
      ORDER BY name ASC NULLS LAST
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
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
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
  private async reverseLookupMunicipality(
    lat: number,
    lon: number,
  ): Promise<string | null> {
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
    let areaHectares = (dto.areaHectares as number | undefined) ?? null;
    let municipality = (dto.municipality as string | undefined) ?? null;
    let centroidGeoJson: string | null = null;

    if (dto.boundary) {
      const boundaryStr =
        typeof dto.boundary === 'string' ? dto.boundary : JSON.stringify(dto.boundary);

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

      // ── Reverse geocode municipality from centroid ──────────────────
      if (municipality === null && centroidGeoJson) {
        const centroid = JSON.parse(centroidGeoJson) as {
          type: string;
          coordinates: [number, number];
        };
        // GeoJSON coordinates are [lon, lat]
        const [lon, lat] = centroid.coordinates;
        municipality = await this.reverseLookupMunicipality(lat, lon);
      }
    }

    // Prefer explicitly provided centroid, fall back to computed one.
    const centroidInput = dto.centroid ?? (centroidGeoJson ? JSON.parse(centroidGeoJson) : null);

    const harvestStatus =
      (dto.harvestStatus as string | undefined) ?? 'planned';

    const result = await this.drizzleProvider.db.execute(sql`
      INSERT INTO parcels (
        organization_id,
        code, name, area_hectares,
        boundary, centroid, address, municipality,
        farmtrack_geofence_id, farm_id, notes, is_active, harvest_status
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
        ${harvestStatus}::harvest_status
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
        created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
    `);
    return result;
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId);

    const setClauses: ReturnType<typeof sql>[] = [];
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
      isActive: 'is_active',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        // GeoJSON geometry fields must be stored via ST_GeomFromGeoJSON.
        if ((key === 'boundary' || key === 'centroid') && dto[key]) {
          const geoJsonStr =
            typeof dto[key] === 'string' ? dto[key] as string : JSON.stringify(dto[key]);
          setClauses.push(
            sql`${sql.raw(column)} = ST_GeomFromGeoJSON(${geoJsonStr})`,
          );
        } else {
          const value = dto[key];
          setClauses.push(sql`${sql.raw(column)} = ${value as string | number | boolean | null}`);
        }
      }
    }

    if ('harvestStatus' in dto && dto.harvestStatus != null) {
      setClauses.push(
        sql`harvest_status = ${dto.harvestStatus as string}::harvest_status`,
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

    await this.drizzleProvider.db.execute(
      sql`UPDATE parcels SET ${setClause} WHERE ${updateWhere}`,
    );
    return this.findById(id, orgId);
  }

  /**
   * When daily planning marks a parcel done / not done, mirror that into
   * parcels.harvest_status: done → harvested; not done → to_harvest.
   */
  async applyHarvestStatusFromDailyPlan(parcelId: string, isDone: boolean, orgId: string | null) {
    const status = isDone ? 'harvested' : 'to_harvest';
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${parcelId}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    await this.drizzleProvider.db.execute(sql`
      UPDATE parcels
      SET harvest_status = ${status}::harvest_status, updated_at = NOW()
      WHERE ${where}
    `);
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
