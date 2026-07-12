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
   * "One scan per request" is enforced the same way the aviz does it: retire the
   * previous one before inserting the replacement. There is no unique constraint
   * backing this, so two writers racing (the loader's queue draining while an
   * admin overrides) can both insert; list() orders created_at DESC, so the UI
   * shows the newest and the loser is an inert extra row.
   */
  private async attachScan(orgId: string, target: ScanTarget, input: SaveCmrScanInput) {
    const saved = await this.uploads.saveCmrScan({
      mimetype: input.mimetype,
      stream: input.stream,
    });

    if (!target.requestId) {
      // An aux trip with no request behind it shouldn't exist, but if it does we
      // still keep the PDF rather than throw it away — it just can't light up the
      // green button on the requests page, so say so loudly.
      this.winston.warn('CMR scan stored without a trip request', {
        tripId: target.tripId,
        fileUrl: saved.key,
      });
    } else {
      await this.documents.softDeleteByTripRequest(orgId, target.requestId, DOCUMENT_TYPE);
    }

    await this.documents.create(orgId, {
      tripId: target.tripId,
      tripRequestId: target.requestId,
      documentType: DOCUMENT_TYPE,
      status: 'generated',
      title: `CMR scanat — ${target.plate ?? 'necunoscut'}`,
      fileUrl: saved.url,
      fileSizeBytes: saved.sizeBytes,
      mimeType: 'application/pdf',
      metadata: { source: input.source, pageCount: input.pageCount ?? null },
    });

    // Re-read rather than returning the INSERT: list() projects to camelCase and
    // the returned fileUrl passes through UploadUrlSigningInterceptor (this is a
    // plain JSON return, not @Res(), so it gets signed on the way out).
    const rows = (await this.documents.list(orgId, 'system', {
      tripRequestId: target.requestId ?? undefined,
      documentType: DOCUMENT_TYPE,
    })) as unknown as Record<string, unknown>[];
    return rows[0];
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
