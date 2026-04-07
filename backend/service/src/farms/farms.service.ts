import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

const FARM_COLS = sql`
  id,
  name,
  address,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

@Injectable()
export class FarmsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list() {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${FARM_COLS} FROM farms WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${FARM_COLS} FROM farms WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Farm ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO farms (name, address)
          VALUES (${dto.name}, ${dto.address ?? null})
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async update(id: string, dto: Record<string, unknown>) {
    await this.findById(id);

    const setClauses: ReturnType<typeof sql>[] = [];
    if ('name' in dto)    setClauses.push(sql`name    = ${dto.name as string}`);
    if ('address' in dto) setClauses.push(sql`address = ${dto.address as string | null}`);

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE farms SET ${setClause}
          WHERE id = ${id} AND deleted_at IS NULL
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async softDelete(id: string) {
    await this.findById(id);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE farms
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = ${id}
          RETURNING ${FARM_COLS}`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
