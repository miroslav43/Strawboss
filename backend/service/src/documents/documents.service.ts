import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class DocumentsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: { tripId?: string; documentType?: string }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.tripId) {
      conditions.push(sql`trip_id = ${filters.tripId}`);
    }
    if (filters?.documentType) {
      conditions.push(sql`document_type = ${filters.documentType}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM documents WHERE ${where} ORDER BY created_at DESC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM documents WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return rows[0];
  }

  async create(data: {
    tripId: string;
    documentType: string;
    title: string;
    status: string;
    fileUrl?: string | null;
    mimeType?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO documents (
        trip_id, document_type, title, status,
        file_url, mime_type, metadata
      ) VALUES (
        ${data.tripId}, ${data.documentType}, ${data.title}, ${data.status},
        ${data.fileUrl ?? null}, ${data.mimeType ?? null},
        ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb
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
