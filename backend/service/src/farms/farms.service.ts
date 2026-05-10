import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

const FARM_COLS = sql`
  id,
  name,
  address,
  phone,
  entity_type AS "entityType",
  cui,
  apia_code   AS "apiaCode",
  created_at  AS "createdAt",
  updated_at  AS "updatedAt",
  deleted_at  AS "deletedAt"
`;

@Injectable()
export class FarmsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${FARM_COLS} FROM farms WHERE ${where} ORDER BY name ASC`,
    );
    return result;
  }

  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${FARM_COLS} FROM farms WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Farm ${id} not found`);
    }
    return rows[0];
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    const entityType = (dto.entityType as string | undefined) ?? null;
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO farms (organization_id, name, address, phone, entity_type, cui, apia_code)
          VALUES (
            ${orgId}::uuid,
            ${dto.name},
            ${dto.address  ?? null},
            ${dto.phone    ?? null},
            ${entityType ? sql`${entityType}::farm_entity_type` : sql`NULL`},
            ${dto.cui      ?? null},
            ${dto.apiaCode ?? null}
          )
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId);

    const setClauses: ReturnType<typeof sql>[] = [];
    if ('name' in dto)       setClauses.push(sql`name        = ${dto.name as string}`);
    if ('address' in dto)    setClauses.push(sql`address     = ${dto.address as string | null}`);
    if ('phone' in dto)      setClauses.push(sql`phone       = ${dto.phone as string | null}`);
    if ('entityType' in dto) {
      const et = dto.entityType as string | null | undefined;
      setClauses.push(et ? sql`entity_type = ${et}::farm_entity_type` : sql`entity_type = NULL`);
    }
    if ('cui' in dto)        setClauses.push(sql`cui         = ${dto.cui as string | null}`);
    if ('apiaCode' in dto)   setClauses.push(sql`apia_code   = ${dto.apiaCode as string | null}`);

    if (setClauses.length === 0) return this.findById(id, orgId);

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const updateConditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    const updateWhere = sql.join(updateConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE farms SET ${setClause}
          WHERE ${updateWhere}
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);

    const deleteConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) deleteConditions.push(sql`organization_id = ${orgId}::uuid`);
    const deleteWhere = sql.join(deleteConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE farms
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE ${deleteWhere}
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
