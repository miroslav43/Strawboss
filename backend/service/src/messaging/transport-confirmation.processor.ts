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
import { AvizNotificationService } from './aviz-notification.service';
import { MessageKind, DEFAULT_LOCALE, isLocale, type Locale } from '@strawboss/types';
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
  beneficiary_email: string | null;
  beneficiary_name: string | null;
  beneficiary_locale: string | null;
  dest_lat: number | null;
  dest_lon: number | null;
}

interface PickupSourceRow {
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
    private readonly avizNotifications: AvizNotificationService,
  ) {
    super();
  }

  // Single worker on the `message-send` queue → routes by job name. Adding a
  // second @Processor on this queue would make the two workers COMPETE for jobs
  // (each job goes to only one), so new job kinds are dispatched from here.
  async process(job: Job): Promise<void> {
    if (job.name === 'aviz-uploaded') {
      const { requestId, fileUrl } = job.data as { requestId: string; fileUrl: string };
      await this.avizNotifications.dispatch(requestId, fileUrl);
      return;
    }
    if (job.name !== 'transport-confirmation') return;
    const { requestId, depotId, parcelId } = job.data as {
      requestId: string;
      depotId?: string;
      parcelId?: string;
    };

    const reqRows = (await this.drizzleProvider.db.execute(
      sql`SELECT tr.requester_name, tr.requester_email, tr.requester_phone,
                 tr.driver_name, tr.driver_email, tr.driver_phone,
                 tr.crop_type, tr.quality, tr.tons_requested, tr.needed_date, tr.notes,
                 tr.destination_address,
                 tr.company_name, tr.company_address, tr.company_cui,
                 tr.truck_registration_plate, tr.trailer_registration_plate, tr.truck_capacity_tons,
                 tr.transporter_name, tr.transporter_cui, tr.transporter_address,
                 tr.notify_recipients,
                 tr.organization_id,
                 b.email        AS beneficiary_email,
                 b.display_name AS beneficiary_name,
                 b.locale       AS beneficiary_locale,
                 ST_Y(tr.destination_coords) AS dest_lat, ST_X(tr.destination_coords) AS dest_lon
          FROM trip_requests tr
          LEFT JOIN beneficiaries b
                 ON b.id = tr.beneficiary_id AND b.deleted_at IS NULL
          WHERE tr.id = ${requestId}::uuid LIMIT 1`,
    )) as unknown as RequestRow[];
    const req = reqRows[0];
    if (!req) return;

    let source: PickupSourceRow | undefined;
    if (depotId) {
      const depotRows = (await this.drizzleProvider.db.execute(
        sql`SELECT name, address,
                   COALESCE(ST_Y(coords), ST_Y(ST_Centroid(boundary))) AS lat,
                   COALESCE(ST_X(coords), ST_X(ST_Centroid(boundary))) AS lon
            FROM delivery_destinations WHERE id = ${depotId}::uuid LIMIT 1`,
      )) as unknown as PickupSourceRow[];
      source = depotRows[0];
    } else if (parcelId) {
      const parcelRows = (await this.drizzleProvider.db.execute(
        sql`SELECT (code || COALESCE(', ' || farm_name, '')) AS name,
                   NULL::text AS address,
                   COALESCE(ST_Y(centroid), ST_Y(ST_Centroid(boundary))) AS lat,
                   COALESCE(ST_X(centroid), ST_X(ST_Centroid(boundary))) AS lon
            FROM parcels WHERE id = ${parcelId}::uuid LIMIT 1`,
      )) as unknown as PickupSourceRow[];
      source = parcelRows[0];
    }

    const orgRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name FROM organizations WHERE id = ${req.organization_id}::uuid LIMIT 1`,
    )) as unknown as { name: string }[];
    const orgName = orgRows[0]?.name ?? 'StrawBoss';

    const pickupCoords: LatLon | null =
      source?.lat != null && source?.lon != null ? { lat: source.lat, lon: source.lon } : null;
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
      label: source?.name ?? 'Depozit',
      address: source?.address ?? null,
      mapsUrl: pickupCoords ? fmtCoordsUrl(pickupCoords.lat, pickupCoords.lon) : null,
    };
    const delivery = {
      label: 'Livrare',
      address: req.destination_address,
      mapsUrl: deliveryCoords ? fmtCoordsUrl(deliveryCoords.lat, deliveryCoords.lon) : null,
    };

    // Optional raster brand logo for the email header (unset → text-only header).
    const logoUrl = this.config.get<string>('EMAIL_LOGO_URL') ?? null;

    // Locale: driver, notify_recipients contacts and the requester fallback
    // are free-text contacts on trip_requests, not `users` rows, so they still
    // have no locale to read (unlike the two new_request_admin call sites in
    // trip-requests.service.ts, which notify actual `users`) — DEFAULT_LOCALE
    // for those. The beneficiary is the one exception: b.locale is a real
    // per-beneficiary setting (see beneficiaries.locale), so its email is
    // rendered in that language below instead of the shared default.
    const renderEmail = (recipientName: string | null, locale: Locale) =>
      messageTemplates[MessageKind.transport_confirmed][locale]({
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
    const emailRecipients: Array<{ to: string; name: string | null; locale: Locale }> = [];
    const smsRecipients: string[] = [];

    const addEmail = (raw: string | null, name: string | null, locale: Locale = DEFAULT_LOCALE) => {
      if (!raw) return;
      const key = raw.trim().toLowerCase();
      if (!key || seenEmails.has(key)) return;
      seenEmails.add(key);
      emailRecipients.push({ to: raw, name, locale });
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

    // The beneficiary company's own email (set on the beneficiary record). Always a
    // recipient when the request came from a beneficiary portal; dedup skips it if it
    // matches a contact/requester address. NULL for generic public requests.
    const beneficiaryLocale = isLocale(req.beneficiary_locale)
      ? req.beneficiary_locale
      : DEFAULT_LOCALE;
    addEmail(req.beneficiary_email, req.beneficiary_name ?? req.company_name, beneficiaryLocale);

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
      const tpl = renderEmail(r.name, r.locale);
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
      // SMS recipients are driver + free-text contacts only (the beneficiary
      // never receives an SMS here), so DEFAULT_LOCALE applies to all of them.
      const sms = messageTemplates[MessageKind.transport_confirmed_driver_sms][DEFAULT_LOCALE]({
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
