import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';
import { Readable } from 'node:stream';
import type { CmrScanKind } from '@strawboss/validation';
import { DrizzleProvider } from '../database/drizzle.provider';
import { UploadsService, CMR_SCAN_MAX_BYTES } from '../uploads/uploads.service';
import { DocumentsService, type SqlExecutor } from '../documents/documents.service';

/**
 * Which `documents.document_type` a scan lands on, per end of the trip.
 * `loading` = the paper CMR the loader photographs at pickup (unchanged type,
 * for backward compat with every row and query written before this split).
 * `delivery` = the photo the external driver uploads at the destination.
 */
const DOCUMENT_TYPE_BY_KIND: Record<CmrScanKind, string> = {
  loading: 'cmr_scan',
  delivery: 'cmr_scan_delivery',
};

const TITLE_PREFIX_BY_KIND: Record<CmrScanKind, string> = {
  loading: 'CMR plecare',
  delivery: 'CMR sosire',
};

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
  source: 'loader_scan' | 'admin_upload' | 'external_driver';
}

/** The trip-request context a scan gets filed against. */
interface ScanTarget {
  requestId: string | null;
  tripId: string | null;
  plate: string | null;
}

interface SavedFile {
  url: string;
  key: string;
  sizeBytes: number;
}

interface AttachMeta {
  kind: CmrScanKind;
  source: SaveCmrScanInput['source'];
  pageCount?: number | null;
}

/**
 * The scanned *paper* CMR — the physical transport document the external driver
 * brings, photographed by the loader at the end of an auxiliary load — AND its
 * counterpart at the OTHER end: the arrival CMR the same driver photographs at
 * the destination and uploads through a one-time public link.
 *
 * Deliberately a leaf module rather than a method on TripsService: the mobile
 * route needs UploadsService + DocumentsService, TripsModule imports neither, and
 * TripRequestsModule already imports TripsModule — so hanging this off either of
 * those would need a forwardRef.
 *
 * Every writer (the loader's phone, an admin/transporter override, the external
 * driver's public upload) funnels into the same `attachScan`, so there is
 * exactly one place that decides how a scan is stored — now keyed on `kind` as
 * well as request, so a `delivery` upload can never clobber the `loading` one.
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
  async uploadForTrip(orgId: string, tripId: string, input: SaveCmrScanInput, kind: CmrScanKind) {
    const target = await this.resolveTargetFromTrip(orgId, tripId);
    const saved = await this.saveFile(input, kind);
    return this.attachScan(orgId, target, saved, {
      kind,
      source: input.source,
      pageCount: input.pageCount,
    });
  }

  /** Admin/dispatcher/transporter: manual upload or override, addressed by request. */
  async uploadForRequest(
    orgId: string,
    requestId: string,
    input: SaveCmrScanInput,
    kind: CmrScanKind,
  ) {
    const target = await this.resolveTargetFromRequest(orgId, requestId);
    const saved = await this.saveFile(input, kind);
    return this.attachScan(orgId, target, saved, {
      kind,
      source: input.source,
      pageCount: input.pageCount,
    });
  }

  /**
   * The public link, step 1 (slow): persist the driver's upload of the arrival
   * CMR to disk. No DB writes — deliberately separate from `attachArrivalCmr`
   * so `TripsService.completeAuxiliaryOnArrivalCmr` can do this OUTSIDE any
   * transaction (a Puppeteer render must never hold a Postgres
   * connection/advisory lock for however long it takes) and only open a
   * transaction for the fast DB-only step that follows.
   *
   * Almost every submission is 1..N photos, rendered into a single PDF
   * (`ImagesToPdfService`, via `saveCmrScanFromImages`). The one exception: a
   * single part that is ALREADY `application/pdf` (a driver with a scanner app,
   * not just a camera) is stored as-is — converting an already-correct PDF
   * through a photo pipeline would only recompress it for no reason.
   */
  async saveArrivalCmrFile(
    parts: { mimetype: string; buffer: Buffer }[],
    scanId?: string | null,
  ): Promise<SavedFile> {
    if (parts.length === 1 && parts[0].mimetype === 'application/pdf') {
      return this.uploads.saveCmrScan(
        { mimetype: 'application/pdf', stream: Readable.from(parts[0].buffer) },
        scanId ?? undefined,
      );
    }
    return this.uploads.saveCmrScanFromImages(
      parts.map((p) => p.buffer),
      scanId ?? undefined,
    );
  }

  /**
   * The public link, step 2 (fast): file an already-saved arrival-CMR PDF as
   * the request's active `delivery` document. Pass `externalTx` so a caller —
   * only `TripsService`, completing the trip in the same commit — can run this
   * inside a transaction it owns instead of `attachScan` opening its own.
   */
  async attachArrivalCmr(
    orgId: string,
    requestId: string,
    saved: SavedFile,
    pageCount: number,
    externalTx?: SqlExecutor,
  ) {
    const target = await this.resolveTargetFromRequest(orgId, requestId);
    return this.attachScan(
      orgId,
      target,
      saved,
      { kind: 'delivery', source: 'external_driver', pageCount },
      externalTx,
    );
  }

  async listForRequest(orgId: string, requestId: string, kind: CmrScanKind) {
    await this.resolveTargetFromRequest(orgId, requestId); // 404 + org check
    return this.documents.list(orgId, 'system', {
      tripRequestId: requestId,
      documentType: DOCUMENT_TYPE_BY_KIND[kind],
    });
  }

  /**
   * Persist the uploaded bytes to disk, converting to PDF first if they arrived
   * as a photo. `loading` (departure) stays PDF-only — the loader's on-device
   * scanner always produces one, and a paper CMR photographed loose by an
   * admin override is exactly the kind of ambiguous document this type was
   * built to keep out — so an image mimetype for that kind is rejected rather
   * than silently converted.
   */
  private async saveFile(input: SaveCmrScanInput, kind: CmrScanKind): Promise<SavedFile> {
    const isImage = input.mimetype.startsWith('image/');
    if (isImage && kind === 'loading') {
      throw new BadRequestException('CMR-ul de plecare trebuie încărcat ca PDF.');
    }
    if (isImage) {
      const buffer = await this.bufferStream(input.stream, CMR_SCAN_MAX_BYTES);
      return this.uploads.saveCmrScanFromImages([buffer], input.scanId ?? undefined);
    }
    return this.uploads.saveCmrScan(
      { mimetype: input.mimetype, stream: input.stream },
      input.scanId ?? undefined,
    );
  }

  /** Buffer a multipart stream into memory with a hard cap (mirrors saveAvatar). */
  private async bufferStream(stream: Readable, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      bytesRead += buf.length;
      if (bytesRead > maxBytes) {
        stream.destroy();
        throw new PayloadTooLargeException(`File exceeds max size of ${maxBytes} bytes`);
      }
      chunks.push(buf);
    }
    if (bytesRead === 0) {
      throw new BadRequestException('Empty file');
    }
    return Buffer.concat(chunks);
  }

  /**
   * Store the file and file it as the request's single active document of
   * this `kind`. "One scan per request per kind" is enforced by retiring the
   * previous one of the SAME kind before inserting the replacement — keyed on
   * `document_type`, so a `delivery` upload never touches the `loading` row
   * and vice versa.
   *
   * The retire+insert runs inside a transaction guarded by a per-request,
   * per-kind advisory lock, so two writers racing (the loader's queue draining
   * while an admin overrides the SAME kind) are serialized: the second sees and
   * retires the first's row instead of both inserting. A mid-write failure
   * rolls the whole thing back — never zero active rows, never two.
   *
   * The freshly-inserted row (projected to camelCase) is returned directly. Its
   * `fileUrl` is signed on egress by UploadUrlSigningInterceptor. We deliberately
   * do NOT re-read via list(): a re-read filtered only by request (or, for an
   * orphan aux trip, by nothing but document_type) could hand back a DIFFERENT
   * trip's scan — leaking its metadata and signed link to the wrong caller.
   *
   * `externalTx`, when given, is used IN PLACE OF opening a new transaction —
   * so a caller that already owns one (`TripsService` completing an aux trip
   * in the same commit as the arrival-CMR insert) gets true atomicity: if the
   * caller's transaction later rolls back, this insert rolls back with it.
   */
  private async attachScan(
    orgId: string,
    target: ScanTarget,
    saved: SavedFile,
    meta: AttachMeta,
    externalTx?: SqlExecutor,
  ) {
    const documentType = DOCUMENT_TYPE_BY_KIND[meta.kind];
    const createData = {
      tripId: target.tripId,
      tripRequestId: target.requestId,
      documentType,
      status: 'generated',
      title: `${TITLE_PREFIX_BY_KIND[meta.kind]} — ${target.plate ?? 'necunoscut'}`,
      fileUrl: saved.url,
      fileSizeBytes: saved.sizeBytes,
      mimeType: 'application/pdf',
      metadata: { source: meta.source, pageCount: meta.pageCount ?? null },
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
      const rows = (await this.documents.create(
        orgId,
        createData,
        externalTx ?? this.drizzleProvider.db,
      )) as unknown as Record<string, unknown>[];
      return rows[0];
    }

    const requestId = target.requestId;
    // Serialize concurrent writers for THIS request AND THIS kind (loader
    // auto-sync vs admin override never contend with the driver's arrival
    // upload — different lock namespace). hashtext() → int4 → the bigint
    // pg_advisory_xact_lock overload; the namespace prefix keeps us from
    // falsely contending with other lock users that happen to hash the same
    // request id. Released automatically at COMMIT of whichever transaction
    // (ours or the caller's) it is issued in.
    const runLockAndInsert = async (tx: SqlExecutor) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`cmr_scan:${meta.kind}:${requestId}`}))`,
      );
      await this.documents.softDeleteByTripRequest(orgId, requestId, documentType, tx);
      const rows = (await this.documents.create(orgId, createData, tx)) as unknown as Record<
        string,
        unknown
      >[];
      return rows[0];
    };

    if (externalTx) return runLockAndInsert(externalTx);
    return this.drizzleProvider.db.transaction((tx) => runLockAndInsert(tx));
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
