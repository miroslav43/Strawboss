import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import Handlebars from 'handlebars';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { DocumentsService } from '../documents.service';
import { DocumentType, DocumentStatus } from '@strawboss/types';

@Injectable()
export class CmrService {
  private readonly template: HandlebarsTemplateDelegate;

  /**
   * Signature URLs are embedded as <img src> in the CMR template and fetched
   * by headless Chromium. Only inline base64 PNG/JPEG data URLs are accepted —
   * any http/https/file URL is dropped to prevent SSRF / data exfiltration.
   */
  private static readonly SIGNATURE_URL_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

  private sanitizeSignatureUrl(value: unknown): string | null {
    return typeof value === 'string' && CmrService.SIGNATURE_URL_PATTERN.test(value) ? value : null;
  }

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly documentsService: DocumentsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    const templatePath = join(__dirname, 'templates', 'cmr.hbs');
    const source = readFileSync(templatePath, 'utf-8');
    this.template = Handlebars.compile(source);
  }

  /**
   * Generate a CMR document for a trip.
   *
   * stage=1: Partial document at departure — loader + driver signatures, no weight/receiver.
   *          Creates a new document with status=partial.
   * stage=2: Final document at destination — all fields including receiver signature.
   *          Finds and updates the existing partial document, or creates a new one.
   */
  async generateCmr(tripId: string, orgId: string | null, stage: 1 | 2 = 2) {
    // 1. Fetch trip data (scoped to org to prevent cross-org data leakage)
    const tripConditions: ReturnType<typeof sql>[] = [
      sql`id = ${tripId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId) tripConditions.push(sql`organization_id = ${orgId}::uuid`);
    const tripWhere = sql.join(tripConditions, sql` AND `);

    const tripResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips WHERE ${tripWhere} LIMIT 1`,
    );
    const trips = tripResult as unknown as Record<string, unknown>[];
    if (!trips.length) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }
    const trip = trips[0];

    // 2. Fetch related data
    const [parcelResult, truckResult, driverResult, baleLoadsResult, loaderOperatorResult] =
      await Promise.all([
        trip.source_parcel_id
          ? this.drizzleProvider.db.execute(
              sql`SELECT * FROM parcels WHERE id = ${trip.source_parcel_id as string}::uuid LIMIT 1`,
            )
          : Promise.resolve([]),
        trip.truck_id
          ? this.drizzleProvider.db.execute(
              sql`SELECT * FROM machines WHERE id = ${trip.truck_id as string}::uuid LIMIT 1`,
            )
          : Promise.resolve([]),
        trip.driver_id
          ? this.drizzleProvider.db.execute(
              sql`SELECT id, full_name, email FROM users WHERE id = ${trip.driver_id as string}::uuid LIMIT 1`,
            )
          : Promise.resolve([]),
        this.drizzleProvider.db.execute(
          sql`SELECT * FROM bale_loads WHERE trip_id = ${tripId}::uuid AND deleted_at IS NULL`,
        ),
        trip.loader_operator_id
          ? this.drizzleProvider.db.execute(
              sql`SELECT id, full_name FROM users WHERE id = ${trip.loader_operator_id as string}::uuid LIMIT 1`,
            )
          : Promise.resolve([]),
      ]);

    const parcel = (parcelResult as unknown as Record<string, unknown>[])[0];
    const truck = (truckResult as unknown as Record<string, unknown>[])[0];
    const driver = (driverResult as unknown as Record<string, unknown>[])[0];
    const baleLoads = baleLoadsResult as unknown as Record<string, unknown>[];
    const loaderOperator = (loaderOperatorResult as unknown as Record<string, unknown>[])[0];

    // 3. Find existing partial document (for stage 2 update) or create a new record
    let docId: string;
    const isStage1 = stage === 1;
    const stageLabel = isStage1 ? ' (Expediere)' : '';
    const titleStr = `CMR - ${trip.trip_number as string}${stageLabel}`;

    if (!isStage1) {
      // Stage 2: look for an existing partial document to update
      const existingResult = await this.drizzleProvider.db.execute(
        sql`SELECT id FROM documents
            WHERE trip_id = ${tripId}::uuid
              AND status = ${DocumentStatus.partial}::document_status
              AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1`,
      );
      const existing = existingResult as unknown as { id: string }[];
      if (existing.length) {
        docId = existing[0].id;
        // Move to generating state
        await this.drizzleProvider.db.execute(
          sql`UPDATE documents SET status = ${DocumentStatus.generating}::document_status,
              title = ${titleStr}, updated_at = NOW()
              WHERE id = ${docId}`,
        );
      } else {
        // No partial doc — create fresh generating record
        const docResult = await this.documentsService.create(orgId, {
          tripId,
          documentType: DocumentType.cmr,
          title: titleStr,
          status: DocumentStatus.generating,
          mimeType: 'application/pdf',
          metadata: {
            tripNumber: trip.trip_number,
            parcelName: parcel?.name ?? null,
            truckPlate: truck?.registration_plate ?? null,
            driverName: driver?.full_name ?? null,
            baleLoadCount: baleLoads.length,
            totalBales: trip.bale_count,
          },
        });
        const docs = docResult as unknown as Record<string, unknown>[];
        docId = docs[0]?.id as string;
      }
    } else {
      // Stage 1: always create a new partial document
      const docResult = await this.documentsService.create(orgId, {
        tripId,
        documentType: DocumentType.cmr,
        title: titleStr,
        status: DocumentStatus.generating,
        mimeType: 'application/pdf',
        metadata: {
          tripNumber: trip.trip_number,
          parcelName: parcel?.name ?? null,
          truckPlate: truck?.registration_plate ?? null,
          driverName: driver?.full_name ?? null,
          baleLoadCount: baleLoads.length,
          totalBales: trip.bale_count,
          stage: 1,
        },
      });
      const docs = docResult as unknown as Record<string, unknown>[];
      docId = docs[0]?.id as string;
    }

    const finalStatus = isStage1 ? DocumentStatus.partial : DocumentStatus.generated;

    try {
      // 4. Render Handlebars template
      const now = new Date();
      const html = this.template({
        tripNumber: trip.trip_number,
        stage,
        isPartial: isStage1,
        date: now.toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' }),
        parcelName: parcel?.name ?? parcel?.code ?? 'N/A',
        senderAddress: parcel?.address ?? 'N/A',
        senderMunicipality: parcel?.municipality ?? '',
        destinationName: trip.destination_name ?? 'N/A',
        destinationAddress: trip.destination_address ?? 'N/A',
        truckName: truck?.internal_code ?? truck?.make ?? 'N/A',
        truckPlate: truck?.registration_plate ?? 'N/A',
        driverName: driver?.full_name ?? 'N/A',
        loaderName: loaderOperator?.full_name ?? '',
        baleCount: trip.bale_count ?? 0,
        grossWeightKg: isStage1 ? null : (trip.gross_weight_kg ?? 'N/A'),
        netWeightKg: isStage1 ? null : (trip.net_weight_kg ?? 'N/A'),
        // Use the trip's actual weigh-ticket tare (the same value net_weight_kg
        // is generated from) so Brut − Tară = Net holds on the document. The
        // machine's static reference tare (truck.tare_weight_kg) is not what was
        // measured at the weighbridge.
        tareWeightKg: isStage1 ? null : (trip.tare_weight_kg ?? 'N/A'),
        weightTicketNumber: isStage1 ? null : (trip.weight_ticket_number ?? 'N/A'),
        deterioratedBalesCount: isStage1 ? null : (trip.deteriorated_bales_count ?? null),
        // Route distance is GPS-derived (populated at arrive), so it only
        // exists from stage-2 onward.
        gpsDistanceKm: isStage1 ? null : (trip.gps_distance_km ?? 'N/A'),
        departureAt: trip.departure_at
          ? new Date(trip.departure_at as string).toLocaleString('ro-RO')
          : 'N/A',
        arrivalAt: isStage1
          ? null
          : trip.arrival_at
            ? new Date(trip.arrival_at as string).toLocaleString('ro-RO')
            : 'N/A',
        deliveredAt: isStage1
          ? null
          : trip.delivered_at
            ? new Date(trip.delivered_at as string).toLocaleString('ro-RO')
            : 'N/A',
        receiverName: isStage1 ? null : (trip.receiver_name ?? 'N/A'),
        loaderSignatureUrl: this.sanitizeSignatureUrl(trip.loader_signature_url),
        driverSignatureUrl: this.sanitizeSignatureUrl(trip.driver_signature_url),
        receiverSignatureUrl: isStage1
          ? null
          : this.sanitizeSignatureUrl(trip.receiver_signature_url),
        deliveryNotes: trip.delivery_notes ?? '',
        baleLoadCount: baleLoads.length,
      });

      // 5. Render PDF with Puppeteer.
      // In Docker (Alpine) there is no bundled Chrome — PUPPETEER_EXECUTABLE_PATH
      // points at the system Chromium installed in the image. Unset locally,
      // where Puppeteer falls back to its own downloaded browser.
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });
      let pdfBuffer: Uint8Array;
      try {
        const page = await browser.newPage();
        // Block every outbound request from the rendered page. The CMR template
        // only needs inline data: resources; any http/https/file URL that slips
        // into a signature field must not be fetched (SSRF / data exfil).
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const url = req.url();
          const allowed =
            url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:');
          (allowed ? req.continue() : req.abort()).catch(() => {});
        });
        await page.setContent(html, { waitUntil: 'networkidle0' });
        pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
        });
      } finally {
        await browser.close().catch(() => {});
      }

      // 6. Store PDF — for now save as base64 data URL (TODO: Supabase Storage)
      const fileUrl = `data:application/pdf;base64,${Buffer.from(pdfBuffer).toString('base64')}`;

      await this.documentsService.updateStatus(docId, orgId, finalStatus, fileUrl);

      this.winston.log(
        'flow',
        `CMR stage-${stage} generated for trip ${trip.trip_number as string}`,
        {
          context: 'CmrService',
          tripId,
          documentId: docId,
          stage,
        },
      );

      return {
        documentId: docId,
        status: finalStatus,
        fileUrl,
      };
    } catch (err) {
      this.winston.error(`CMR stage-${stage} generation failed`, {
        context: 'CmrService',
        tripId,
        documentId: docId,
        stage,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });

      await this.documentsService.updateStatus(docId, orgId, DocumentStatus.failed);

      return {
        documentId: docId,
        status: DocumentStatus.failed,
        fileUrl: null,
      };
    }
  }
}
