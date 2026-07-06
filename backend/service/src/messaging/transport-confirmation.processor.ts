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

interface NotifyRecipientRow {
  name: string;
  phone: string | null;
  email: string | null;
}

interface RequestRow {
  requester_name: string;
  requester_email: string | null;
  requester_phone: string | null;
  driver_name: string;
  driver_email: string | null;
  driver_phone: string;
  crop_type: string | null;
  quality: string | null;
  tons_requested: number | null;
  needed_date: string | null;
  notes: string | null;
  destination_address: string | null;
  company_name: string | null;
  company_address: string | null;
  company_cui: string | null;
  truck_registration_plate: string | null;
  trailer_registration_plate: string | null;
  truck_capacity_tons: number | null;
  transporter_name: string | null;
  transporter_cui: string | null;
  transporter_address: string | null;
  notify_recipients: NotifyRecipientRow[];
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
      sql`SELECT requester_name, requester_email, requester_phone,
                 driver_name, driver_email, driver_phone,
                 crop_type, quality, tons_requested, needed_date, notes, destination_address,
                 company_name, company_address, company_cui,
                 truck_registration_plate, trailer_registration_plate, truck_capacity_tons,
                 transporter_name, transporter_cui, transporter_address,
                 notify_recipients,
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

    // Optional raster brand logo for the email header (unset → text-only header).
    const logoUrl = this.config.get<string>('EMAIL_LOGO_URL') ?? null;

    const renderEmail = (recipientName: string | null) =>
      messageTemplates[MessageKind.transport_confirmed]({
        organizationName: orgName,
        recipientName,
        driverName: req.driver_name,
        cropType: req.crop_type,
        quality: req.quality,
        tonsRequested: req.tons_requested,
        neededDate: req.needed_date,
        notes: req.notes,
        requesterPhone: req.requester_phone,
        companyName: req.company_name,
        companyCui: req.company_cui,
        companyAddress: req.company_address,
        truckRegistrationPlate: req.truck_registration_plate,
        trailerRegistrationPlate: req.trailer_registration_plate,
        truckCapacityTons: req.truck_capacity_tons,
        transporterName: req.transporter_name,
        transporterCui: req.transporter_cui,
        transporterAddress: req.transporter_address,
        pickup,
        delivery,
        routeUrl,
        distanceKm,
        staticMapUrl: mapImg,
        logoUrl,
      });

    // Build the deduped recipient sets. Driver first (primary operational
    // contact), then every selected contact (beneficiary portal). Falls back to
    // the legacy single requester when notify_recipients is empty — covers
    // pre-migration rows AND the non-beneficiary public portal.
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const emailRecipients: Array<{ to: string; name: string | null }> = [];
    const smsRecipients: string[] = [];

    const addEmail = (raw: string | null, name: string | null) => {
      if (!raw) return;
      const key = raw.trim().toLowerCase();
      if (!key || seenEmails.has(key)) return;
      seenEmails.add(key);
      emailRecipients.push({ to: raw, name });
    };
    const addSms = (raw: string | null) => {
      if (!raw) return;
      const key = raw.replace(/[\s\-()]/g, '');
      if (!key || seenPhones.has(key)) return;
      seenPhones.add(key);
      smsRecipients.push(raw);
    };

    addEmail(req.driver_email, req.driver_name);
    addSms(req.driver_phone);

    const notifyRecipients = Array.isArray(req.notify_recipients) ? req.notify_recipients : [];
    for (const r of notifyRecipients) {
      addEmail(r.email, r.name);
      addSms(r.phone);
    }
    if (notifyRecipients.length === 0) {
      addEmail(req.requester_email, req.requester_name);
      addSms(req.requester_phone);
    }

    // One detailed email per distinct recipient (personalized greeting) — each is
    // its own outbox row, individually retryable from /messages.
    for (const r of emailRecipients) {
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

    // SMS to every distinct phone (driver + contacts). Body is recipient-agnostic,
    // rendered once; the SIM-gateway phone claims each pending row on /fleet/checkin.
    if (smsRecipients.length) {
      const sms = messageTemplates[MessageKind.transport_confirmed_driver_sms]({
        pickupName: pickup.label,
        pickupMapsUrl: pickup.mapsUrl,
        deliveryAddress: delivery.address,
        deliveryMapsUrl: delivery.mapsUrl,
        distanceKm,
        neededDate: req.needed_date,
      });
      for (const to of smsRecipients) {
        await this.messaging.sendSms({
          to,
          body: sms.body,
          kind: MessageKind.transport_confirmed_driver_sms,
          metadata: meta,
        });
      }
    }

    this.winston.log('flow', `Transport confirmation dispatched for request ${requestId}`, {
      context: 'TransportConfirmationProcessor',
      requestId,
      emails: emailRecipients.length,
      smsCount: smsRecipients.length,
      routed: distanceKm != null,
    });
  }
}
