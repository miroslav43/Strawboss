import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { AlertDraft } from '@strawboss/domain';

@Injectable()
export class AlertsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    filters?: {
      category?: string;
      severity?: string;
      isAcknowledged?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.category) {
      conditions.push(sql`category = ${filters.category}`);
    }
    if (filters?.severity) {
      conditions.push(sql`severity = ${filters.severity}`);
    }
    if (filters?.isAcknowledged !== undefined) {
      const ack = filters.isAcknowledged === 'true';
      conditions.push(sql`is_acknowledged = ${ack}`);
    }

    if (conditions.length === 0) {
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100`,
      );
      return result;
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM alerts WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
    );
    return result;
  }

  async listUnacknowledged(orgId: string | null) {
    if (orgId) {
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT * FROM alerts WHERE is_acknowledged = false AND organization_id = ${orgId}::uuid ORDER BY created_at DESC`,
      );
      return result;
    }
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM alerts WHERE is_acknowledged = false ORDER BY created_at DESC`,
    );
    return result;
  }

  async acknowledge(id: string, userId: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}`];
    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);

    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM alerts WHERE ${where} LIMIT 1`,
    );
    const rows = existing as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    const updateConditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`];
    if (orgId !== null) updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    const updateWhere = sql.join(updateConditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(sql`
      UPDATE alerts
      SET acknowledged_at = NOW(), acknowledged_by = ${userId}::uuid, updated_at = NOW()
      WHERE ${updateWhere}
    `);
    return result;
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (id, category, severity, title, description, machine_id, organization_id, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${dto.category},
        ${(dto.severity as string) || 'medium'},
        ${dto.title},
        ${dto.description},
        ${(dto.machineId as string) || null},
        ${orgId}::uuid,
        NOW(), NOW()
      )
      RETURNING id, category, severity, title, description,
        machine_id AS "machineId",
        created_at AS "createdAt"`,
    );
    return result;
  }

  async createFromDraft(draft: AlertDraft, orgId: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (
        category, severity, title, description,
        trip_id, machine_id, data, is_acknowledged,
        organization_id
      ) VALUES (
        ${draft.category}, ${draft.severity}, ${draft.title}, ${draft.description},
        ${draft.tripId}, ${draft.machineId},
        ${JSON.stringify(draft.data)}::jsonb, false,
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }
}
