import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class DocumentsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(orgId: string | null, filters?: { tripId?: string; documentType?: string }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.tripId) {
      conditions.push(sql`trip_id = ${filters.tripId}`);
    }
    if (filters?.documentType) {
      conditions.push(sql`document_type = ${filters.documentType}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT 1000`,
    );
    return result;
  }

  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}`,
      sql`deleted_at IS NULL`,
    ];

    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM documents WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return rows[0];
  }

  async create(
    orgId: string,
    data: {
      tripId: string;
      documentType: string;
      title: string;
      status: string;
      fileUrl?: string | null;
      mimeType?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO documents (
        trip_id, document_type, title, status,
        file_url, mime_type, metadata, organization_id
      ) VALUES (
        ${data.tripId}, ${data.documentType}, ${data.title}, ${data.status},
        ${data.fileUrl ?? null}, ${data.mimeType ?? null},
        ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }

  async updateStatus(
    id: string,
    status: string,
    fileUrl?: string | null,
  ) {
    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${status}`,
      sql`updated_at = NOW()`,
    ];

    if (status === 'generated' || status === 'sent') {
      setClauses.push(sql`generated_at = NOW()`);
    }
    if (fileUrl !== undefined) {
      setClauses.push(sql`file_url = ${fileUrl}`);
    }

    const setClause = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE documents SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    return result;
  }
}
