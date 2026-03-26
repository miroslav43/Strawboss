import { Injectable, BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { SyncMutation, SyncResult } from '@strawboss/types';

/** Tables that support sync (have a sync_version column). */
const SYNCABLE_TABLES = new Set([
  'trips',
  'bale_loads',
  'bale_productions',
  'fuel_logs',
  'consumable_logs',
  'task_assignments',
  'machines',
  'parcels',
]);

@Injectable()
export class SyncService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Process a batch of offline mutations with idempotency.
   */
  async push(mutations: SyncMutation[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const mutation of mutations) {
      if (!SYNCABLE_TABLES.has(mutation.table)) {
        throw new BadRequestException(
          `Table '${mutation.table}' is not syncable`,
        );
      }

      // 1. Idempotency check
      const existing = await this.drizzleProvider.db.execute(
        sql`SELECT server_version, result_data FROM sync_idempotency
            WHERE client_id = ${mutation.clientId}
              AND table_name = ${mutation.table}
              AND record_id = ${mutation.recordId}
              AND client_version = ${mutation.clientVersion}
            LIMIT 1`,
      );
      const existingRows = existing as unknown as Record<string, unknown>[];

      if (existingRows.length > 0) {
        // Already processed — return cached result
        results.push({
          table: mutation.table,
          recordId: mutation.recordId,
          status: 'skipped',
          serverVersion: existingRows[0].server_version as number,
          data: existingRows[0].result_data as Record<string, unknown> | null,
        });
        continue;
      }

      // 2. Apply the mutation
      let resultData: Record<string, unknown> | null = null;
      let serverVersion = 0;

      if (mutation.action === 'insert') {
        const dataWithVersion = { ...mutation.data, sync_version: 1 };
        const columns = Object.keys(dataWithVersion);
        const values = Object.values(dataWithVersion);

        const colsSql = sql.raw(columns.map((c) => `"${c}"`).join(', '));
        const placeholders = values.map((v) =>
          typeof v === 'object' && v !== null
            ? sql`${JSON.stringify(v)}::jsonb`
            : sql`${v}`,
        );
        const valsSql = sql.join(placeholders, sql`, `);

        const insertResult = await this.drizzleProvider.db.execute(
          sql`INSERT INTO ${sql.raw(`"${mutation.table}"`)} (${colsSql})
              VALUES (${valsSql})
              RETURNING *`,
        );
        const rows = insertResult as unknown as Record<string, unknown>[];
        resultData = rows[0] ?? null;
        serverVersion = 1;
      } else if (mutation.action === 'update') {
        // Get current sync_version
        const currentResult = await this.drizzleProvider.db.execute(
          sql`SELECT sync_version FROM ${sql.raw(`"${mutation.table}"`)}
              WHERE id = ${mutation.recordId} LIMIT 1`,
        );
        const currentRows = currentResult as unknown as Record<string, unknown>[];
        const currentVersion = (currentRows[0]?.sync_version as number) ?? 0;
        serverVersion = currentVersion + 1;

        const setClauses: ReturnType<typeof sql>[] = [
          sql`sync_version = ${serverVersion}`,
          sql`updated_at = NOW()`,
        ];
        for (const [key, value] of Object.entries(mutation.data)) {
          if (key !== 'id' && key !== 'sync_version' && key !== 'updated_at') {
            if (typeof value === 'object' && value !== null) {
              setClauses.push(
                sql`${sql.raw(`"${key}"`)} = ${JSON.stringify(value)}::jsonb`,
              );
            } else {
              setClauses.push(sql`${sql.raw(`"${key}"`)} = ${value}`);
            }
          }
        }

        const setClause = sql.join(setClauses, sql`, `);
        const updateResult = await this.drizzleProvider.db.execute(
          sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
              SET ${setClause}
              WHERE id = ${mutation.recordId}
              RETURNING *`,
        );
        const rows = updateResult as unknown as Record<string, unknown>[];
        resultData = rows[0] ?? null;
      } else if (mutation.action === 'delete') {
        // Soft delete
        const currentResult = await this.drizzleProvider.db.execute(
          sql`SELECT sync_version FROM ${sql.raw(`"${mutation.table}"`)}
              WHERE id = ${mutation.recordId} LIMIT 1`,
        );
        const currentRows = currentResult as unknown as Record<string, unknown>[];
        const currentVersion = (currentRows[0]?.sync_version as number) ?? 0;
        serverVersion = currentVersion + 1;

        await this.drizzleProvider.db.execute(
          sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
              SET deleted_at = NOW(), sync_version = ${serverVersion}, updated_at = NOW()
              WHERE id = ${mutation.recordId}`,
        );
      }

      // 3. Record in idempotency table
      await this.drizzleProvider.db.execute(
        sql`INSERT INTO sync_idempotency (
          client_id, table_name, record_id, client_version,
          server_version, result_data
        ) VALUES (
          ${mutation.clientId}, ${mutation.table}, ${mutation.recordId},
          ${mutation.clientVersion}, ${serverVersion},
          ${resultData ? JSON.stringify(resultData) : null}::jsonb
        )`,
      );

      results.push({
        table: mutation.table,
        recordId: mutation.recordId,
        status: 'applied',
        serverVersion,
        data: resultData,
      });
    }

    return results;
  }

  /**
   * Delta sync: for each table, return records with sync_version > requested version.
   */
  async pull(tables: Record<string, number>) {
    const deltas: Record<string, unknown[]> = {};

    for (const [table, sinceVersion] of Object.entries(tables)) {
      if (!SYNCABLE_TABLES.has(table)) {
        continue;
      }

      const result = await this.drizzleProvider.db.execute(
        sql`SELECT * FROM ${sql.raw(`"${table}"`)}
            WHERE sync_version > ${sinceVersion}
            ORDER BY sync_version ASC`,
      );
      deltas[table] = result as unknown as unknown[];
    }

    return {
      deltas,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Return last processed version per table for a given client.
   */
  async status(clientId: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT table_name, MAX(server_version) as last_version
          FROM sync_idempotency
          WHERE client_id = ${clientId}
          GROUP BY table_name`,
    );
    const rows = result as unknown as {
      table_name: string;
      last_version: number;
    }[];

    const status: Record<string, number> = {};
    for (const row of rows) {
      status[row.table_name] = row.last_version;
    }

    return { clientId, tables: status };
  }
}
