import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { DocumentsService } from '../documents.service';
import { DocumentType, DocumentStatus } from '@strawboss/types';

@Injectable()
export class CmrService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Generate a CMR document for a trip.
   *
   * Currently a stub implementation: creates a document record and
   * marks it as generated with a placeholder URL. A real implementation
   * would use Puppeteer + Handlebars to render the CMR template to PDF.
   */
  async generateCmr(tripId: string) {
    // 1. Fetch trip data
    const tripResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips WHERE id = ${tripId} AND deleted_at IS NULL LIMIT 1`,
    );
    const trips = tripResult as unknown as Record<string, unknown>[];
    if (!trips.length) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }
    const trip = trips[0];

    // 2. Fetch related data
    const [parcelResult, truckResult, driverResult, baleLoadsResult] =
      await Promise.all([
        this.drizzleProvider.db.execute(
          sql`SELECT * FROM parcels WHERE id = ${trip.source_parcel_id as string} LIMIT 1`,
        ),
        this.drizzleProvider.db.execute(
          sql`SELECT * FROM machines WHERE id = ${trip.truck_id as string} LIMIT 1`,
        ),
        this.drizzleProvider.db.execute(
          sql`SELECT id, email FROM auth.users WHERE id = ${trip.driver_id as string} LIMIT 1`,
        ).catch(() => [] as unknown[]),
        this.drizzleProvider.db.execute(
          sql`SELECT * FROM bale_loads WHERE trip_id = ${tripId} AND deleted_at IS NULL`,
        ),
      ]);

    const parcels = parcelResult as unknown as Record<string, unknown>[];
    const trucks = truckResult as unknown as Record<string, unknown>[];
    const drivers = driverResult as unknown as Record<string, unknown>[];
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
        parcelName: parcels[0]?.name ?? null,
        truckPlate: trucks[0]?.registration_plate ?? null,
        driverId: trip.driver_id,
        driverEmail: drivers[0]?.email ?? null,
        baleLoadCount: baleLoads.length,
        totalBales: trip.bale_count,
      },
    });

    const docs = docResult as unknown as Record<string, unknown>[];
    const docId = docs[0]?.id as string;

    // 4. Stub: In a real implementation we would render the Handlebars template
    //    with Puppeteer and upload to storage. For now, mark as generated with
    //    a placeholder URL.
    const placeholderUrl = `/documents/${docId}/cmr-placeholder.pdf`;
    await this.documentsService.updateStatus(
      docId,
      DocumentStatus.generated,
      placeholderUrl,
    );

    return {
      documentId: docId,
      status: DocumentStatus.generated,
      fileUrl: placeholderUrl,
    };
  }
}
