import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { MESSAGING_SERVICE, type IMessagingService } from './messaging.tokens';
import { messageTemplates, fmtCoordsUrl, fmtDirectionsUrl } from './message-templates';
import { buildRoute, staticMapUrl, type LatLon } from './route-map';
import { MessageKind } from '@strawboss/types';
import { QUEUE_MESSAGE_SEND } from '../jobs/queues';

interface RequestRow {
  requester_name: string;
  requester_email: string | null;
  driver_name: string;
  driver_email: string | null;
  driver_phone: string;
  crop_type: string | null;
  tons_requested: number | null;
  needed_date: string | null;
  notes: string | null;
  destination_address: string | null;
  organization_id: string;
  dest_lat: number | null;
  dest_lon: number | null;
}

interface DepotRow {
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

/** Renders + sends the transport-confirmation email (driver + requester) and the driver SMS. */
@Processor(QUEUE_MESSAGE_SEND)
export class TransportConfirmationProcessor extends WorkerHost {
  private readonly logger = new Logger(TransportConfirmationProcessor.name);

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly config: ConfigService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {
    super();
  }

  async process(job: Job<{ requestId: string; depotId: string }>): Promise<void> {
    if (job.name !== 'transport-confirmation') return;
    const { requestId, depotId } = job.data;

    const reqRows = (await this.drizzleProvider.db.execute(
      sql`SELECT requester_name, requester_email, driver_name, driver_email, driver_phone,
                 crop_type, tons_requested, needed_date, notes, destination_address,
                 organization_id,
                 ST_Y(destination_coords) AS dest_lat, ST_X(destination_coords) AS dest_lon
          FROM trip_requests WHERE id = ${requestId}::uuid LIMIT 1`,
    )) as unknown as RequestRow[];
    const req = reqRows[0];
    if (!req) return;

    const depotRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name, address,
                 COALESCE(ST_Y(coords), ST_Y(ST_Centroid(boundary))) AS lat,
                 COALESCE(ST_X(coords), ST_X(ST_Centroid(boundary))) AS lon
          FROM delivery_destinations WHERE id = ${depotId}::uuid LIMIT 1`,
    )) as unknown as DepotRow[];
    const depot = depotRows[0];

    const orgRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name FROM organizations WHERE id = ${req.organization_id}::uuid LIMIT 1`,
    )) as unknown as { name: string }[];
    const orgName = orgRows[0]?.name ?? 'StrawBoss';

    const pickupCoords: LatLon | null =
      depot?.lat != null && depot?.lon != null ? { lat: depot.lat, lon: depot.lon } : null;
    const deliveryCoords: LatLon | null =
      req.dest_lat != null && req.dest_lon != null
        ? { lat: req.dest_lat, lon: req.dest_lon }
        : null;

    // Route + static map + distance — only when both endpoints have coordinates.
    let distanceKm: number | null = null;
    let mapImg: string | null = null;
    const routeUrl: string | null = fmtDirectionsUrl(pickupCoords, deliveryCoords);
    if (pickupCoords && deliveryCoords) {
      const route = await buildRoute(
        this.config.get<string>('OSRM_BASE_URL', 'https://router.project-osrm.org'),
        pickupCoords,
        deliveryCoords,
      );
      distanceKm = route.distanceKm;
      mapImg = staticMapUrl(
        this.config.get<string>(
          'STATICMAP_BASE_URL',
          'https://staticmap.openstreetmap.de/staticmap.php',
        ),
        pickupCoords,
        deliveryCoords,
        route.points,
      );
    }

    const meta = { orgId: req.organization_id, requestId };
    const pickup = {
      label: depot?.name ?? 'Depozit',
      address: depot?.address ?? null,
      mapsUrl: pickupCoords ? fmtCoordsUrl(pickupCoords.lat, pickupCoords.lon) : null,
    };
    const delivery = {
      label: 'Livrare',
      address: req.destination_address,
      mapsUrl: deliveryCoords ? fmtCoordsUrl(deliveryCoords.lat, deliveryCoords.lon) : null,
    };

    const renderEmail = (recipientName: string | null) =>
      messageTemplates[MessageKind.transport_confirmed]({
        organizationName: orgName,
        recipientName,
        driverName: req.driver_name,
        cropType: req.crop_type,
        tonsRequested: req.tons_requested,
        neededDate: req.needed_date,
        notes: req.notes,
        pickup,
        delivery,
        routeUrl,
        distanceKm,
        staticMapUrl: mapImg,
      });

    // Driver email + requester email (both detailed).
    const recipients: Array<{ to: string; name: string }> = [];
    if (req.driver_email) recipients.push({ to: req.driver_email, name: req.driver_name });
    if (req.requester_email) recipients.push({ to: req.requester_email, name: req.requester_name });
    for (const r of recipients) {
      const tpl = renderEmail(r.name);
      await this.messaging.sendEmail({
        to: r.to,
        subject: tpl.subject,
        body: tpl.body,
        html: tpl.html,
        kind: MessageKind.transport_confirmed,
        metadata: meta,
      });
    }

    // Driver SMS.
    if (req.driver_phone) {
      const sms = messageTemplates[MessageKind.transport_confirmed_driver_sms]({
        pickupName: pickup.label,
        pickupMapsUrl: pickup.mapsUrl,
        deliveryAddress: delivery.address,
        deliveryMapsUrl: delivery.mapsUrl,
        distanceKm,
        neededDate: req.needed_date,
      });
      await this.messaging.sendSms({
        to: req.driver_phone,
        body: sms.body,
        kind: MessageKind.transport_confirmed_driver_sms,
        metadata: meta,
      });
    }

    this.winston.log('flow', `Transport confirmation dispatched for request ${requestId}`, {
      context: 'TransportConfirmationProcessor',
      requestId,
      emails: recipients.length,
      routed: distanceKm != null,
    });
  }
}
