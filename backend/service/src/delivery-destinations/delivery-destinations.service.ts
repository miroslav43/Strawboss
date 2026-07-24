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
  depot_type      AS "depotType",
  confirm_radius_m AS "confirmRadiusM",
  created_at      AS "createdAt",
  updated_at      AS "updatedAt",
  deleted_at      AS "deletedAt"
`;

@Injectable()
export class DeliveryDestinationsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(orgId: string | null, filters?: { isActive?: boolean }) {
    const conditions: ReturnType<typeof sql>[] = [sql`d.deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`d.organization_id = ${orgId}::uuid`);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(sql`d.is_active = ${filters.isActive}`);
    }

    const where = sql.join(conditions, sql` AND `);
    // List projection: same columns as DEST_COLS plus a correlated subquery
    // that surfaces the most recent activity (task_assignments referencing the
    // destination). Used by the admin UI to show "ultima activitate".
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        d.id, d.code, d.name, d.address,
        ST_AsGeoJSON(d.coords)::json AS coords,
        d.contact_name    AS "contactName",
        d.contact_phone   AS "contactPhone",
        d.contact_email   AS "contactEmail",
        ST_AsGeoJSON(d.boundary)::json AS boundary,
        d.is_active       AS "isActive",
        d.is_default      AS "isDefault",
        d.depot_type      AS "depotType",
        d.confirm_radius_m AS "confirmRadiusM",
        d.created_at      AS "createdAt",
        d.updated_at      AS "updatedAt",
        d.deleted_at      AS "deletedAt",
        (
          SELECT MAX(ta.updated_at)
          FROM task_assignments ta
          WHERE ta.destination_id = d.id AND ta.deleted_at IS NULL
        ) AS "lastActivityAt",
        -- read-only enrichment: current bales in the depot = INBOUND - OUTBOUND.
        -- Outbound (bale_loads loaded straight out of this depot, 00073) used to be
        -- missing entirely — the comment here literally read "No outbound in the
        -- model" — so the figure was an all-time accumulator and overstated every
        -- depot that had ever dispatched a truck from its own yard.
        -- Same formula as reports.getDepotReports and DepositInventoryService.
        GREATEST(
          COALESCE((
            SELECT SUM(t.bale_count)::int
            FROM trips t
            WHERE t.destination_name = d.name
              AND t.status IN ('delivered', 'completed')
              AND t.deleted_at IS NULL
              AND t.organization_id = d.organization_id
          ), 0)
          -
          COALESCE((
            SELECT SUM(bl.bale_count)::int
            FROM bale_loads bl
            WHERE bl.source_depot_id = d.id
              AND bl.deleted_at IS NULL
              AND bl.organization_id = d.organization_id
          ), 0),
          0
        ) AS "currentBaleStock"
      FROM delivery_destinations d
      WHERE ${where}
      ORDER BY d.name ASC
    `);
    return result;
  }

  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DEST_COLS} FROM delivery_destinations WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`DeliveryDestination ${id} not found`);
    }
    return rows[0];
  }

  async create(orgId: string | null, dto: Record<string, unknown>) {
    const toGeo = (val: unknown) =>
      val
        ? sql`ST_GeomFromGeoJSON(${typeof val === 'string' ? val : JSON.stringify(val)})`
        : sql`NULL`;

    const isDefault = dto.isDefault === true;

    return await this.drizzleProvider.db.transaction(async (tx) => {
      if (isDefault) {
        const demoteConditions: ReturnType<typeof sql>[] = [
          sql`is_default = TRUE`,
          sql`deleted_at IS NULL`,
        ];
        if (orgId !== null) demoteConditions.push(sql`organization_id = ${orgId}::uuid`);
        const demoteWhere = sql.join(demoteConditions, sql` AND `);
        await tx.execute(
          sql`UPDATE delivery_destinations SET is_default = FALSE, updated_at = NOW()
              WHERE ${demoteWhere}`,
        );
      }

      const result = await tx.execute(
        sql`INSERT INTO delivery_destinations (
              organization_id,
              code, name, address, coords,
              contact_name, contact_phone, contact_email, boundary, is_default,
              depot_type, confirm_radius_m
            ) VALUES (
              ${orgId}::uuid,
              ${dto.code as string},
              ${dto.name as string},
              ${(dto.address as string) ?? null},
              ${toGeo(dto.coords)},
              ${(dto.contactName as string) ?? null},
              ${(dto.contactPhone as string) ?? null},
              ${(dto.contactEmail as string) ?? null},
              ${toGeo(dto.boundary)},
              ${isDefault},
              ${(dto.depotType as string) ?? 'principal'},
              ${(dto.confirmRadiusM as number) ?? 300}
            )
            RETURNING ${DEST_COLS}`,
      );
      return (result as unknown as Record<string, unknown>[])[0];
    });
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId);

    const plainFields: Record<string, string> = {
      code: 'code',
      name: 'name',
      address: 'address',
      contactName: 'contact_name',
      contactPhone: 'contact_phone',
      contactEmail: 'contact_email',
      isActive: 'is_active',
      isDefault: 'is_default',
      depotType: 'depot_type',
      confirmRadiusM: 'confirm_radius_m',
    };

    return await this.drizzleProvider.db.transaction(async (tx) => {
      // Promoting this row to default → demote any other current default.
      if (dto.isDefault === true) {
        const demoteConditions: ReturnType<typeof sql>[] = [
          sql`is_default = TRUE`,
          sql`deleted_at IS NULL`,
          sql`id != ${id}::uuid`,
        ];
        if (orgId !== null) demoteConditions.push(sql`organization_id = ${orgId}::uuid`);
        const demoteWhere = sql.join(demoteConditions, sql` AND `);
        await tx.execute(
          sql`UPDATE delivery_destinations SET is_default = FALSE, updated_at = NOW()
              WHERE ${demoteWhere}`,
        );
      }

      const setClauses: ReturnType<typeof sql>[] = [];

      for (const [key, column] of Object.entries(plainFields)) {
        if (key in dto) {
          setClauses.push(sql`${sql.raw(column)} = ${dto[key] as string | boolean | null}`);
        }
      }

      for (const key of ['coords', 'boundary'] as const) {
        if (key in dto) {
          if (dto[key]) {
            const geoJsonStr =
              typeof dto[key] === 'string' ? (dto[key] as string) : JSON.stringify(dto[key]);
            setClauses.push(sql`${sql.raw(key)} = ST_GeomFromGeoJSON(${geoJsonStr})`);
          } else {
            setClauses.push(sql`${sql.raw(key)} = NULL`);
          }
        }
      }

      if (setClauses.length === 0) return this.findById(id, orgId);

      setClauses.push(sql`updated_at = NOW()`);
      const setClause = sql.join(setClauses, sql`, `);

      const updateConditions: ReturnType<typeof sql>[] = [
        sql`id = ${id}::uuid`,
        sql`deleted_at IS NULL`,
      ];
      if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
      const updateWhere = sql.join(updateConditions, sql` AND `);

      const result = await tx.execute(
        sql`UPDATE delivery_destinations SET ${setClause}
            WHERE ${updateWhere}
            RETURNING ${DEST_COLS}`,
      );
      return (result as unknown as Record<string, unknown>[])[0];
    });
  }

  /** Returns the single row marked is_default = TRUE, or null. */
  async findDefault(orgId: string | null): Promise<{ id: string } | null> {
    const conditions: ReturnType<typeof sql>[] = [
      sql`is_default = TRUE`,
      sql`deleted_at IS NULL`,
      sql`is_active = TRUE`,
    ];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM delivery_destinations WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as { id: string }[];
    return rows[0] ?? null;
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);

    const deleteConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) deleteConditions.push(sql`organization_id = ${orgId}::uuid`);
    const deleteWhere = sql.join(deleteConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE delivery_destinations
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE ${deleteWhere}
          RETURNING ${DEST_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
