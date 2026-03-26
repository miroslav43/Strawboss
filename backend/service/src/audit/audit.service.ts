import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class AuditService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async log(
    tableName: string,
    recordId: string,
    operation: string,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    userId: string | null,
    clientId?: string | null,
    ipAddress?: string | null,
  ) {
    const changedFields =
      oldValues && newValues
        ? Object.keys(newValues).filter(
            (key) =>
              JSON.stringify(newValues[key]) !==
              JSON.stringify(oldValues[key]),
          )
        : null;

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO audit_logs (
        table_name, record_id, operation, old_values, new_values,
        changed_fields, user_id, client_id, ip_address
      ) VALUES (
        ${tableName}, ${recordId}, ${operation},
        ${oldValues ? JSON.stringify(oldValues) : null}::jsonb,
        ${newValues ? JSON.stringify(newValues) : null}::jsonb,
        ${changedFields ? JSON.stringify(changedFields) : null}::jsonb,
        ${userId ?? null}, ${clientId ?? null}, ${ipAddress ?? null}
      ) RETURNING *`,
    );
    return result;
  }

  async getByRecord(tableName: string, recordId: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM audit_logs
          WHERE table_name = ${tableName} AND record_id = ${recordId}
          ORDER BY created_at DESC`,
    );
    return result;
  }

  async list(filters?: {
    tableName?: string;
    userId?: string;
    operation?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [];

    if (filters?.tableName) {
      conditions.push(sql`table_name = ${filters.tableName}`);
    }
    if (filters?.userId) {
      conditions.push(sql`user_id = ${filters.userId}`);
    }
    if (filters?.operation) {
      conditions.push(sql`operation = ${filters.operation}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`created_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`created_at <= ${filters.dateTo}`);
    }

    if (conditions.length === 0) {
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`,
      );
      return result;
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
    );
    return result;
  }
}
