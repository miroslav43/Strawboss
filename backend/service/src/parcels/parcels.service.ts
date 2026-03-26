import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class ParcelsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: { municipality?: string; isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.municipality) {
      conditions.push(sql`municipality = ${filters.municipality}`);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM parcels WHERE ${where} ORDER BY created_at DESC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM parcels WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Parcel ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO parcels (
        code, name, owner_name, owner_contact, area_hectares,
        boundary, centroid, address, municipality,
        farmtrack_geofence_id, notes, is_active
      ) VALUES (
        ${dto.code}, ${dto.name}, ${dto.ownerName},
        ${dto.ownerContact ?? null}, ${dto.areaHectares},
        ${dto.boundary ?? null}, ${dto.centroid ? JSON.stringify(dto.centroid) : null},
        ${dto.address}, ${dto.municipality},
        ${dto.farmtrackGeofenceId ?? null}, ${dto.notes ?? null}, true
      ) RETURNING *`,
    );
    return result;
  }

  async update(id: string, dto: Record<string, unknown>) {
    await this.findById(id);

    const setClauses: ReturnType<typeof sql>[] = [];
    const fieldMap: Record<string, string> = {
      code: 'code',
      name: 'name',
      ownerName: 'owner_name',
      ownerContact: 'owner_contact',
      areaHectares: 'area_hectares',
      boundary: 'boundary',
      centroid: 'centroid',
      address: 'address',
      municipality: 'municipality',
      farmtrackGeofenceId: 'farmtrack_geofence_id',
      notes: 'notes',
      isActive: 'is_active',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        const value =
          key === 'centroid' && dto[key] ? JSON.stringify(dto[key]) : dto[key];
        setClauses.push(sql`${sql.raw(column)} = ${value as string | number | boolean | null}`);
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE parcels SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    return result;
  }

  async softDelete(id: string) {
    await this.findById(id);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE parcels SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} RETURNING *`,
    );
    return result;
  }
}
