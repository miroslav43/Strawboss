import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';
import type { Readable } from 'node:stream';
import { DrizzleProvider } from '../database/drizzle.provider';
import { UploadsService } from '../uploads/uploads.service';
import { DocumentsService } from '../documents/documents.service';

const DOCUMENT_TYPE = 'cmr_scan';

export interface SaveCmrScanInput {
  mimetype: string;
  stream: Readable;
  /** How many pages the loader scanned. Null when an admin uploads a PDF by hand. */
  pageCount?: number | null;
  /**
   * Stable per-scan UUID minted on-device before the first upload attempt. Used
   * as the storage filename so an ambiguous-failure retry OVERWRITES the same
   * blob instead of leaving an orphan behind (a fresh UUID per attempt would).
   * Absent for admin uploads — those fall back to a random filename.
   */
  scanId?: string | null;
  source: 'loader_scan' | 'admin_upload';
}

/** The trip-request context a scan gets filed against. */
interface ScanTarget {
  requestId: string | null;
  tripId: string | null;
  plate: string | null;
}

/**
 * The scanned *paper* CMR — the physical transport document the external driver
 * brings, photographed by the loader at the end of an auxiliary load.
 *
 * Deliberately a leaf module rather than a method on TripsService: the mobile
 * route needs UploadsService + DocumentsService, TripsModule imports neither, and
 * TripRequestsModule already imports TripsModule — so hanging this off either of
 * those would need a forwardRef.
 *
 * Both writers (the loader's phone, keyed by trip; an admin override, keyed by
 * request) funnel into the same `attachScan`, so there is exactly one place that
 * decides how a scan is stored.
 */
@Injectable()
export class CmrScansService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly uploads: UploadsService,
    private readonly documents: DocumentsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /** Mobile: the loader posts the PDF it built on-device, addressed by trip. */
  async uploadForTrip(orgId: string, tripId: string, input: SaveCmrScanInput) {
    const target = await this.resolveTargetFromTrip(orgId, tripId);
    return this.attachScan(orgId, target, input);
  }

  /** Admin/dispatcher: manual upload or override, addressed by request. */
  async uploadForRequest(orgId: string, requestId: string, input: SaveCmrScanInput) {
    const target = await this.resolveTargetFromRequest(orgId, requestId);
    return this.attachScan(orgId, target, input);
  }

  async listForRequest(orgId: string, requestId: string) {
    await this.resolveTargetFromRequest(orgId, requestId); // 404 + org check
    return this.documents.list(orgId, 'system', {
      tripRequestId: requestId,
      documentType: DOCUMENT_TYPE,
    });
  }

  /**
   * Store the PDF and file it as the request's single active `cmr_scan` document.
   *
   * "One scan per request" is enforced by retiring the previous one before
   * inserting the replacement. The retire+insert runs inside a transaction
   * guarded by a per-request advisory lock, so two writers racing (the loader's
   * queue draining while an admin overrides) are serialized: the second sees and
   * retires the first's row instead of both inserting. A mid-write failure rolls
   * the whole thing back — never zero active rows, never two.
   *
   * The freshly-inserted row (projected to camelCase) is returned directly. Its
   * `fileUrl` is signed on egress by UploadUrlSigningInterceptor. We deliberately
   * do NOT re-read via list(): a re-read filtered only by request (or, for an
   * orphan aux trip, by nothing but document_type) could hand back a DIFFERENT
   * trip's scan — leaking its metadata and signed link to the wrong caller.
   */
  private async attachScan(orgId: string, target: ScanTarget, input: SaveCmrScanInput) {
    const saved = await this.uploads.saveCmrScan(
      { mimetype: input.mimetype, stream: input.stream },
      input.scanId ?? undefined,
    );

    const createData = {
      tripId: target.tripId,
      tripRequestId: target.requestId,
      documentType: DOCUMENT_TYPE,
      status: 'generated',
      title: `CMR scanat — ${target.plate ?? 'necunoscut'}`,
      fileUrl: saved.url,
      fileSizeBytes: saved.sizeBytes,
      mimeType: 'application/pdf',
      metadata: { source: input.source, pageCount: input.pageCount ?? null },
    };

    if (!target.requestId) {
      // An aux trip with no request behind it shouldn't exist, but if it does we
      // still keep the PDF rather than throw it away — it just can't light up the
      // green button on the requests page, so say so loudly. Nothing to dedupe
      // against without a request, so a plain insert (no transaction) is enough.
      this.winston.warn('CMR scan stored without a trip request', {
        tripId: target.tripId,
        fileUrl: saved.key,
      });
      const rows = (await this.documents.create(orgId, createData)) as unknown as Record<
        string,
        unknown
      >[];
      return rows[0];
    }

    const requestId = target.requestId;
    const created = await this.drizzleProvider.db.transaction(async (tx) => {
      // Serialize concurrent writers for THIS request (loader auto-sync vs admin
      // override). hashtext() → int4 → the bigint pg_advisory_xact_lock overload;
      // the namespace prefix keeps us from falsely contending with other lock users
      // that happen to hash the same request id. Released automatically on commit.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cmr_scan:${requestId}`}))`);
      await this.documents.softDeleteByTripRequest(orgId, requestId, DOCUMENT_TYPE, tx);
      const rows = (await this.documents.create(orgId, createData, tx)) as unknown as Record<
        string,
        unknown
      >[];
      return rows[0];
    });
    return created;
  }

  private async resolveTargetFromTrip(orgId: string, tripId: string): Promise<ScanTarget> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT t.id                       AS "tripId",
                 t.trip_request_id          AS "requestId",
                 tr.truck_registration_plate AS "plate"
          FROM trips t
          LEFT JOIN trip_requests tr ON tr.id = t.trip_request_id
          WHERE t.id = ${tripId}::uuid
            AND t.organization_id = ${orgId}::uuid
            AND t.deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as ScanTarget[];

    const row = rows[0];
    if (!row) throw new NotFoundException(`Trip ${tripId} not found`);
    if (row.requestId) return row;

    // Defensive: trips.trip_request_id is written when the aux trip is created,
    // but the back-link on trip_requests.trip_id is written separately. Try it
    // before giving up on the request.
    const fallback = (await this.drizzleProvider.db.execute(
      sql`SELECT id AS "requestId", truck_registration_plate AS "plate"
          FROM trip_requests
          WHERE trip_id = ${tripId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { requestId: string; plate: string | null }[];

    return {
      tripId,
      requestId: fallback[0]?.requestId ?? null,
      plate: fallback[0]?.plate ?? null,
    };
  }

  private async resolveTargetFromRequest(orgId: string, requestId: string): Promise<ScanTarget> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id                       AS "requestId",
                 trip_id                  AS "tripId",
                 truck_registration_plate AS "plate"
          FROM trip_requests
          WHERE id = ${requestId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as ScanTarget[];

    const row = rows[0];
    if (!row) throw new NotFoundException(`Trip request ${requestId} not found`);
    return row;
  }
}
