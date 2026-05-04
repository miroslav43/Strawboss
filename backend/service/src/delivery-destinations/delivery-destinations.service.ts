import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

const DEST_COLS = sql`
  id, code, name, address,
  ST_AsGeoJSON(coords)::json AS coords,
  contact_name    AS "contactName",
  contact_phone   AS "contactPhone",
  contact_email   AS "contactEmail",
  ST_AsGeoJSON(boundary)::json AS boundary,
  is_active       AS "isActive",
  is_default      AS "isDefault",
  created_at      AS "createdAt",
  updated_at      AS "updatedAt",
  deleted_at      AS "deletedAt"
`;

@Injectable()
export class DeliveryDestinationsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: { isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.isActive !== undefined) {
      conditions.push(sql`is_active = ${filters.isActive}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DEST_COLS} FROM delivery_destinations WHERE ${where} ORDER BY name ASC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DEST_COLS} FROM delivery_destinations WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`DeliveryDestination ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: Record<string, unknown>) {
    const toGeo = (val: unknown) =>
      val
        ? sql`ST_GeomFromGeoJSON(${typeof val === 'string' ? val : JSON.stringify(val)})`
        : sql`NULL`;

    const isDefault = dto.isDefault === true;

    return await this.drizzleProvider.db.transaction(async (tx) => {
      if (isDefault) {
        await tx.execute(
          sql`UPDATE delivery_destinations SET is_default = FALSE, updated_at = NOW()
              WHERE is_default = TRUE AND deleted_at IS NULL`,
        );
      }

      const result = await tx.execute(
        sql`INSERT INTO delivery_destinations (
              code, name, address, coords,
              contact_name, contact_phone, contact_email, boundary, is_default
            ) VALUES (
              ${dto.code as string},
              ${dto.name as string},
              ${(dto.address as string) ?? null},
              ${toGeo(dto.coords)},
              ${(dto.contactName as string) ?? null},
              ${(dto.contactPhone as string) ?? null},
              ${(dto.contactEmail as string) ?? null},
              ${toGeo(dto.boundary)},
              ${isDefault}
            )
            RETURNING ${DEST_COLS}`,
      );
      return (result as unknown as Record<string, unknown>[])[0];
    });
  }

  async update(id: string, dto: Record<string, unknown>) {
    await this.findById(id);

    const plainFields: Record<string, string> = {
      code: 'code',
      name: 'name',
      address: 'address',
      contactName: 'contact_name',
      contactPhone: 'contact_phone',
      contactEmail: 'contact_email',
      isActive: 'is_active',
      isDefault: 'is_default',
    };

    return await this.drizzleProvider.db.transaction(async (tx) => {
      // Promoting this row to default → demote any other current default.
      if (dto.isDefault === true) {
        await tx.execute(
          sql`UPDATE delivery_destinations SET is_default = FALSE, updated_at = NOW()
              WHERE is_default = TRUE AND deleted_at IS NULL AND id != ${id}`,
        );
      }

      const setClauses: ReturnType<typeof sql>[] = [];

      for (const [key, column] of Object.entries(plainFields)) {
        if (key in dto) {
          setClauses.push(
            sql`${sql.raw(column)} = ${dto[key] as string | boolean | null}`,
          );
        }
      }

      for (const key of ['coords', 'boundary'] as const) {
        if (key in dto) {
          if (dto[key]) {
            const geoJsonStr =
              typeof dto[key] === 'string'
                ? (dto[key] as string)
                : JSON.stringify(dto[key]);
            setClauses.push(
              sql`${sql.raw(key)} = ST_GeomFromGeoJSON(${geoJsonStr})`,
            );
          } else {
            setClauses.push(sql`${sql.raw(key)} = NULL`);
          }
        }
      }

      if (setClauses.length === 0) return this.findById(id);

      setClauses.push(sql`updated_at = NOW()`);
      const setClause = sql.join(setClauses, sql`, `);

      const result = await tx.execute(
        sql`UPDATE delivery_destinations SET ${setClause}
            WHERE id = ${id} AND deleted_at IS NULL
            RETURNING ${DEST_COLS}`,
      );
      return (result as unknown as Record<string, unknown>[])[0];
    });
  }

  /** Returns the single row marked is_default = TRUE, or null. */
  async findDefault(): Promise<{ id: string } | null> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM delivery_destinations
          WHERE is_default = TRUE AND deleted_at IS NULL AND is_active = TRUE
          LIMIT 1`,
    );
    const rows = result as unknown as { id: string }[];
    return rows[0] ?? null;
  }

  async softDelete(id: string) {
    await this.findById(id);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE delivery_destinations
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = ${id}
          RETURNING ${DEST_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
