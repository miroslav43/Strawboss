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
   * Renders the Handlebars template to HTML, converts to PDF via Puppeteer,
   * and stores the result.
   */
  async generateCmr(tripId: string) {
    // 1. Fetch trip data
    const tripResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips WHERE id = ${tripId}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    const trips = tripResult as unknown as Record<string, unknown>[];
    if (!trips.length) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }
    const trip = trips[0];

    // 2. Fetch related data
    const [parcelResult, truckResult, driverResult, baleLoadsResult, _destinationResult] =
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
        !trip.destination_name
          ? Promise.resolve([])
          : this.drizzleProvider.db.execute(
              sql`SELECT name, address, contact_name FROM delivery_destinations
                  WHERE name = ${trip.destination_name as string} LIMIT 1`,
            ).catch(() => []),
      ]);

    const parcel = (parcelResult as unknown as Record<string, unknown>[])[0];
    const truck = (truckResult as unknown as Record<string, unknown>[])[0];
    const driver = (driverResult as unknown as Record<string, unknown>[])[0];
    const baleLoads = baleLoadsResult as unknown as Record<string, unknown>[];

    // 3. Create document record in 'generating' state
    const docResult = await this.documentsService.create({
      tripId,
      documentType: DocumentType.cmr,
      title: `CMR - ${trip.trip_number as string}`,
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
    const docId = docs[0]?.id as string;

    try {
      // 4. Render Handlebars template
      const now = new Date();
      const html = this.template({
        tripNumber: trip.trip_number,
        date: now.toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' }),
        parcelName: parcel?.name ?? parcel?.code ?? 'N/A',
        senderAddress: parcel?.address ?? 'N/A',
        senderMunicipality: parcel?.municipality ?? '',
        destinationName: trip.destination_name ?? 'N/A',
        destinationAddress: trip.destination_address ?? 'N/A',
        truckName: truck?.internal_code ?? truck?.make ?? 'N/A',
        truckPlate: truck?.registration_plate ?? 'N/A',
        driverName: driver?.full_name ?? 'N/A',
        baleCount: trip.bale_count ?? 0,
        grossWeightKg: trip.gross_weight_kg ?? 'N/A',
        netWeightKg: trip.net_weight_kg ?? 'N/A',
        tareWeightKg: truck?.tare_weight_kg ?? 'N/A',
        weightTicketNumber: trip.weight_ticket_number ?? 'N/A',
        departureOdometerKm: trip.departure_odometer_km ?? 'N/A',
        arrivalOdometerKm: trip.arrival_odometer_km ?? 'N/A',
        odometerDistanceKm: trip.odometer_distance_km ?? 'N/A',
        departureAt: trip.departure_at
          ? new Date(trip.departure_at as string).toLocaleString('ro-RO')
          : 'N/A',
        arrivalAt: trip.arrival_at
          ? new Date(trip.arrival_at as string).toLocaleString('ro-RO')
          : 'N/A',
        deliveredAt: trip.delivered_at
          ? new Date(trip.delivered_at as string).toLocaleString('ro-RO')
          : 'N/A',
        receiverName: trip.receiver_name ?? 'N/A',
        receiverSignatureUrl: trip.receiver_signature_url ?? null,
        deliveryNotes: trip.delivery_notes ?? '',
        loaderName: '',
        baleLoadCount: baleLoads.length,
      });

      // 5. Render PDF with Puppeteer
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      let pdfBuffer: Uint8Array;
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
        });
      } finally {
        await browser.close().catch(() => {});
      }

      // 6. Store PDF — for now save as base64 data URL (real impl would upload to Supabase Storage)
      // In production: upload to Supabase Storage bucket 'documents' and get signed URL
      const fileUrl = `data:application/pdf;base64,${Buffer.from(pdfBuffer).toString('base64')}`;

      await this.documentsService.updateStatus(
        docId,
        DocumentStatus.generated,
        fileUrl,
      );

      this.winston.log('flow', `CMR generated for trip ${trip.trip_number}`, {
        context: 'CmrService',
        tripId,
        documentId: docId,
      });

      return {
        documentId: docId,
        status: DocumentStatus.generated,
        fileUrl,
      };
    } catch (err) {
      this.winston.error('CMR generation failed', {
        context: 'CmrService',
        tripId,
        documentId: docId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });

      await this.documentsService.updateStatus(docId, DocumentStatus.failed);

      return {
        documentId: docId,
        status: DocumentStatus.failed,
        fileUrl: null,
      };
    }
  }
}
