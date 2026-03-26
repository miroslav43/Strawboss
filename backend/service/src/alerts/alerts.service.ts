import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { AlertDraft } from '@strawboss/domain';

@Injectable()
export class AlertsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: {
    category?: string;
    severity?: string;
    isAcknowledged?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [];

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

  async listUnacknowledged() {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM alerts WHERE is_acknowledged = false ORDER BY created_at DESC`,
    );
    return result;
  }

  async acknowledge(id: string, userId: string) {
    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM alerts WHERE id = ${id} LIMIT 1`,
    );
    const rows = existing as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE alerts SET
        is_acknowledged = true,
        acknowledged_by = ${userId},
        acknowledged_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} RETURNING *`,
    );
    return result;
  }

  async createFromDraft(draft: AlertDraft) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO alerts (
        category, severity, title, description,
        trip_id, machine_id, data, is_acknowledged
      ) VALUES (
        ${draft.category}, ${draft.severity}, ${draft.title}, ${draft.description},
        ${draft.tripId}, ${draft.machineId},
        ${JSON.stringify(draft.data)}::jsonb, false
      ) RETURNING *`,
    );
    return result;
  }
}
