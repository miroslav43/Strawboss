import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

// Project columns to camelCase — the API contract (@strawboss/types Document)
// and the admin UI expect camelCase; a raw SELECT * returns snake_case, which
// leaves fileUrl/documentType/etc. undefined on the client.
const DOCUMENT_COLUMNS = sql`
  id,
  trip_id          AS "tripId",
  trip_request_id  AS "tripRequestId",
  document_type    AS "documentType",
  status,
  title,
  file_url         AS "fileUrl",
  file_size_bytes  AS "fileSizeBytes",
  mime_type        AS "mimeType",
  metadata,
  generated_at     AS "generatedAt",
  sent_at          AS "sentAt",
  sent_to          AS "sentTo",
  created_at       AS "createdAt",
  updated_at       AS "updatedAt",
  deleted_at       AS "deletedAt",
  organization_id  AS "organizationId"
`;

@Injectable()
export class DocumentsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    callerRole: string,
    filters?: { tripId?: string; tripRequestId?: string; documentType?: string },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    // The unfiltered (cross-org) branch is gated on an explicit super_admin
    // role, never on `orgId` being null — an unauthenticated/anon identity
    // also produces a null orgId and must never see every org's documents.
    if (callerRole !== 'super_admin') {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.tripId) {
      conditions.push(sql`trip_id = ${filters.tripId}`);
    }
    if (filters?.tripRequestId) {
      conditions.push(sql`trip_request_id = ${filters.tripRequestId}::uuid`);
    }
    if (filters?.documentType) {
      conditions.push(sql`document_type = ${filters.documentType}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT 1000`,
    );
    return result;
  }

  async findById(id: string, orgId: string | null, callerRole: string) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}`, sql`deleted_at IS NULL`];

    // Same rule as list(): only an explicit super_admin caller may skip the
    // org filter.
    if (callerRole !== 'super_admin') {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE ${where} LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return rows[0];
  }

  async create(
    orgId: string | null,
    data: {
      tripId?: string | null;
      tripRequestId?: string | null;
      documentType: string;
      title: string;
      status: string;
      fileUrl?: string | null;
      fileSizeBytes?: number | null;
      mimeType?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO documents (
        trip_id, trip_request_id, document_type, title, status,
        file_url, file_size_bytes, mime_type, metadata, organization_id
      ) VALUES (
        ${data.tripId ?? null}, ${data.tripRequestId ?? null}, ${data.documentType}, ${data.title}, ${data.status},
        ${data.fileUrl ?? null}, ${data.fileSizeBytes ?? null}, ${data.mimeType ?? null},
        ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
        ${orgId ? sql`${orgId}::uuid` : sql`NULL`}
      ) RETURNING *`,
    );
    return result;
  }

  /**
   * Soft-delete every active document of a given type for a trip request.
   * Used to enforce "one aviz per request" — the previous aviz is retired
   * before a replacement is inserted, so listAvize() returns a single row.
   */
  async softDeleteByTripRequest(orgId: string | null, tripRequestId: string, documentType: string) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`trip_request_id = ${tripRequestId}::uuid`,
      sql`document_type = ${documentType}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    await this.drizzleProvider.db.execute(
      sql`UPDATE documents SET deleted_at = NOW(), updated_at = NOW() WHERE ${where}`,
    );
  }

  async updateStatus(id: string, orgId: string | null, status: string, fileUrl?: string | null) {
    const setClauses: ReturnType<typeof sql>[] = [sql`status = ${status}`, sql`updated_at = NOW()`];

    if (status === 'generated' || status === 'sent') {
      setClauses.push(sql`generated_at = NOW()`);
    }
    if (fileUrl !== undefined) {
      setClauses.push(sql`file_url = ${fileUrl}`);
    }

    const setClause = sql.join(setClauses, sql`, `);

    const whereConditions: ReturnType<typeof sql>[] = [sql`id = ${id}`];
    if (orgId !== null) whereConditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(whereConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE documents SET ${setClause} WHERE ${where} RETURNING *`,
    );
    return result;
  }
}
