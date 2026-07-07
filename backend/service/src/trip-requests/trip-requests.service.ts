import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { AlertsService } from '../alerts/alerts.service';
import { BeneficiariesService } from '../beneficiaries/beneficiaries.service';
import { UploadsService } from '../uploads/uploads.service';
import { DocumentsService } from '../documents/documents.service';
import { PinThrottleService } from './pin-throttle.service';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_MESSAGE_SEND } from '../jobs/queues';
import { MESSAGING_SERVICE, type IMessagingService } from '../messaging/messaging.tokens';
import { messageTemplates } from '../messaging/message-templates';
import { MessageKind, RequestStatus } from '@strawboss/types';
import type {
  TripRequest,
  PortalInfo,
  CreateTripRequestDto,
  PublicBeneficiaryInfo,
  CropType,
} from '@strawboss/types';
import type { CreateBeneficiaryRequestInput } from '@strawboss/validation';

/** All trip_requests columns aliased to camelCase; coords → {lat,lon}. */
const TR_COLS = sql`
  id,
  organization_id          AS "organizationId",
  status,
  requester_name           AS "requesterName",
  requester_phone          AS "requesterPhone",
  requester_email          AS "requesterEmail",
  company_name             AS "companyName",
  company_address          AS "companyAddress",
  company_cui              AS "companyCui",
  truck_registration_plate AS "truckRegistrationPlate",
  truck_make               AS "truckMake",
  truck_model              AS "truckModel",
  truck_capacity_tons      AS "truckCapacityTons",
  driver_name              AS "driverName",
  driver_phone             AS "driverPhone",
  driver_email             AS "driverEmail",
  crop_type                AS "cropType",
  quality                  AS "quality",
  needed_date              AS "neededDate",
  tons_requested           AS "tonsRequested",
  destination_address      AS "destinationAddress",
  destination_locality     AS "destinationLocality",
  CASE WHEN destination_coords IS NULL THEN NULL
       ELSE json_build_object('lat', ST_Y(destination_coords), 'lon', ST_X(destination_coords))
  END                      AS "destinationCoords",
  notes,
  machine_id               AS "machineId",
  trip_id                  AS "tripId",
  confirmed_by             AS "confirmedBy",
  confirmed_at             AS "confirmedAt",
  cancelled_at             AS "cancelledAt",
  cancellation_reason      AS "cancellationReason",
  beneficiary_id               AS "beneficiaryId",
  trailer_registration_plate   AS "trailerRegistrationPlate",
  transporter_cui              AS "transporterCui",
  transporter_name             AS "transporterName",
  transporter_address          AS "transporterAddress",
  contact_id                   AS "contactId",
  truck_id                     AS "truckId",
  driver_id                    AS "driverId",
  notify_recipients            AS "notifyRecipients",
  source_depot_id              AS "sourceDepotId",
  created_at               AS "createdAt",
  updated_at               AS "updatedAt",
  deleted_at               AS "deletedAt",
  (SELECT m.make               FROM machines m WHERE m.id = trip_requests.machine_id) AS "machineMake",
  (SELECT m.model              FROM machines m WHERE m.id = trip_requests.machine_id) AS "machineModel",
  (SELECT m.registration_plate FROM machines m WHERE m.id = trip_requests.machine_id) AS "machinePlate",
  (SELECT t.trip_number        FROM trips t    WHERE t.id = trip_requests.trip_id)    AS "tripNumber",
  (SELECT dd.name       FROM delivery_destinations dd WHERE dd.id = trip_requests.source_depot_id) AS "sourceDepotName",
  (SELECT u.full_name   FROM users u                  WHERE u.id = trip_requests.confirmed_by)     AS "confirmedByName",
  EXISTS(SELECT 1 FROM documents d
         WHERE d.trip_request_id = trip_requests.id
           AND d.document_type = 'delivery_note' AND d.deleted_at IS NULL) AS "hasAviz"
`;

interface OrgPortalRow {
  id: string;
  name: string;
  request_access_code: string | null;
  allowed_crop_types: string[] | null;
}

/** Constant-time PIN comparison — matches the codebase's timingSafeEqual standard. */
export function pinEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** A daily PIN is rejected once it is older than this (cron rotates it at 02:00). */
export const PIN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class TripRequestsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly alertsService: AlertsService,
    private readonly beneficiariesService: BeneficiariesService,
    private readonly uploads: UploadsService,
    private readonly documents: DocumentsService,
    private readonly pinThrottle: PinThrottleService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
    @InjectQueue(QUEUE_MESSAGE_SEND) private readonly messageQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  // ── Authed (admin/dispatcher) ────────────────────────────────────────────

  async list(orgId: string | null, status?: string): Promise<TripRequest[]> {
    const conditions = [sql`deleted_at IS NULL`];
    if (orgId) conditions.push(sql`organization_id = ${orgId}::uuid`);
    if (status) conditions.push(sql`status = ${status}::request_status`);
    const where = sql.join(conditions, sql` AND `);
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT ${TR_COLS} FROM trip_requests WHERE ${where} ORDER BY created_at DESC`,
    );
    return rows as unknown as TripRequest[];
  }

  async findById(orgId: string | null, id: string): Promise<TripRequest> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT ${TR_COLS} FROM trip_requests
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          ${orgId ? sql`AND organization_id = ${orgId}::uuid` : sql``}
          LIMIT 1`,
    )) as unknown as TripRequest[];
    if (!rows.length) throw new NotFoundException(`Trip request ${id} not found`);
    return rows[0];
  }

  /**
   * Confirm a pending request → mint a one-time auxiliary truck (machines row,
   * is_auxiliary=true) from the requester's truck/company data. The admin then
   * assigns a loader on the truck board, which materializes the trip
   * (autoUpsertAuxiliaryTrip).
   */
  async confirm(
    orgId: string | null,
    id: string,
    userId: string,
    depotId: string,
    internalCode?: string,
  ) {
    const req = await this.findById(orgId, id);
    if (req.status !== RequestStatus.pending) {
      throw new BadRequestException('Cererea a fost deja procesată.');
    }
    // The pickup depot must belong to the request's org.
    const depotRows = (await this.drizzleProvider.db.execute(
      sql`SELECT 1 FROM delivery_destinations
          WHERE id = ${depotId}::uuid
            AND organization_id = ${req.organizationId}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as unknown[];
    if (!depotRows.length) throw new BadRequestException('Depozit invalid.');

    const code = internalCode ?? `AUX-${randomUUID().slice(0, 6).toUpperCase()}`;

    const machineRows = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO machines (
            organization_id, machine_type, is_auxiliary,
            registration_plate, internal_code, make, model,
            owner_company_name, owner_company_address, owner_company_cui,
            is_active
          ) VALUES (
            ${req.organizationId}::uuid, 'truck'::machine_type, true,
            ${req.truckRegistrationPlate}, ${code}, ${req.truckMake ?? null}, ${req.truckModel ?? null},
            ${req.companyName ?? null}, ${req.companyAddress ?? null}, ${req.companyCui ?? null},
            true
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    const machineId = machineRows[0]?.id;

    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trip_requests SET
            status = ${RequestStatus.confirmed}::request_status,
            machine_id = ${machineId}::uuid,
            source_depot_id = ${depotId}::uuid,
            confirmed_by = ${userId}::uuid,
            confirmed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${id}::uuid
          RETURNING ${TR_COLS}`,
    )) as unknown as TripRequest[];

    this.winston.log('flow', `Trip request ${id} confirmed → aux truck ${machineId}`, {
      context: 'TripRequestsService',
      requestId: id,
      machineId,
    });

    // Dispatch the detailed transport-confirmation email (driver + requester) and
    // the driver SMS asynchronously — the route/map/distance rendering happens in
    // the processor so confirm() stays fast.
    await this.messageQueue.add(
      'transport-confirmation',
      { requestId: id, depotId },
      { removeOnComplete: true, attempts: 1 },
    );

    return updated[0];
  }

  async cancel(orgId: string | null, id: string, reason?: string) {
    const req = await this.findById(orgId, id);
    if (req.status === RequestStatus.confirmed) {
      throw new BadRequestException('O cerere confirmată nu mai poate fi anulată.');
    }
    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trip_requests SET
            status = ${RequestStatus.cancelled}::request_status,
            cancelled_at = NOW(),
            cancellation_reason = ${reason ?? null},
            updated_at = NOW()
          WHERE id = ${id}::uuid
          RETURNING ${TR_COLS}`,
    )) as unknown as TripRequest[];
    return updated[0];
  }

  // ── Avize (delivery-note PDFs attached to a request) ─────────────────────

  /**
   * Attach an aviz PDF to a request. Enforces one aviz per request: the previous
   * one (if any) is soft-deleted before the new `documents` row is inserted.
   * The stored file is served via the signed /api/v1/uploads/ static route.
   */
  async uploadAviz(
    orgId: string,
    requestId: string,
    input: { mimetype: string; filename: string; stream: Readable },
  ) {
    const req = await this.findById(orgId, requestId); // 404 + org check
    const saved = await this.uploads.saveAviz({
      mimetype: input.mimetype,
      stream: input.stream,
    });
    await this.documents.softDeleteByTripRequest(orgId, requestId, 'delivery_note');
    await this.documents.create(orgId, {
      tripId: req.tripId ?? null,
      tripRequestId: requestId,
      documentType: 'delivery_note',
      status: 'generated',
      title: `Aviz — ${req.truckRegistrationPlate}`,
      fileUrl: saved.url,
      fileSizeBytes: saved.sizeBytes,
      mimeType: 'application/pdf',
    });
    // Notify every recipient (email w/ PDF attached + link, SMS w/ link) async.
    await this.messageQueue.add(
      'aviz-uploaded',
      { requestId, fileUrl: saved.url },
      { removeOnComplete: true, attempts: 1 },
    );
    // Return the freshly-inserted row projected to camelCase (matches GET :id/aviz).
    // 'system' is not the super_admin sentinel, so DocumentsService.list always
    // applies the `orgId` filter here — this call is already org-scoped by the
    // findById() org check above, never a cross-org super_admin lookup.
    const rows = (await this.documents.list(orgId, 'system', {
      tripRequestId: requestId,
      documentType: 'delivery_note',
    })) as unknown as Record<string, unknown>[];
    return rows[0];
  }

  /** List the aviz document(s) attached to a request (0 or 1 with single-aviz). */
  async listAvize(orgId: string, requestId: string) {
    await this.findById(orgId, requestId); // 404 + org check
    return this.documents.list(orgId, 'system', {
      tripRequestId: requestId,
      documentType: 'delivery_note',
    });
  }

  // ── Public (no auth, code-gated) ──────────────────────────────────────────

  /** Verify the 4-digit portal code for a slug; returns portal metadata. */
  async verifyPortalCode(slug: string, code: string): Promise<PortalInfo> {
    const org = await this.resolveOrgBySlug(slug);
    if (!org.request_access_code || org.request_access_code !== code) {
      throw new ForbiddenException('Cod invalid.');
    }
    return {
      organizationName: org.name,
      allowedCropTypes: (org.allowed_crop_types ?? []) as PortalInfo['allowedCropTypes'],
    };
  }

  /** Public submission: re-checks the code, inserts the request, alerts admins. */
  async submitPublicRequest(
    slug: string,
    code: string,
    dto: CreateTripRequestDto,
  ): Promise<{ ok: true }> {
    const org = await this.resolveOrgBySlug(slug);
    if (!org.request_access_code || org.request_access_code !== code) {
      throw new ForbiddenException('Cod invalid.');
    }
    const allowed = org.allowed_crop_types ?? [];
    if (dto.cropType && allowed.length && !allowed.includes(dto.cropType)) {
      throw new BadRequestException('Recoltă neacceptată.');
    }

    const coords = dto.destinationCoords ?? null;
    const inserted = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO trip_requests (
            organization_id, requester_name, requester_phone, requester_email,
            company_name, company_address, company_cui,
            truck_registration_plate, truck_model, truck_capacity_tons,
            driver_name, driver_phone, driver_email,
            crop_type, needed_date, tons_requested,
            destination_address, destination_coords, notes
          ) VALUES (
            ${org.id}::uuid, ${dto.requesterName}, ${dto.requesterPhone}, ${dto.requesterEmail ?? null},
            ${dto.companyName ?? null}, ${dto.companyAddress ?? null}, ${dto.companyCui ?? null},
            ${dto.truckRegistrationPlate}, ${dto.truckModel ?? null}, ${dto.truckCapacityTons ?? null},
            ${dto.driverName}, ${dto.driverPhone}, ${dto.driverEmail ?? null},
            ${dto.cropType ? sql`${dto.cropType}::crop_type` : sql`NULL`}, ${dto.neededDate ?? null}, ${dto.tonsRequested ?? null},
            ${dto.destinationAddress ?? null},
            ${coords ? sql`ST_SetSRID(ST_MakePoint(${coords.lon}, ${coords.lat}), 4326)` : sql`NULL`},
            ${dto.notes ?? null}
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    const requestId = inserted[0]?.id;

    // In-app alert for admins/dispatchers.
    await this.alertsService.create(org.id, {
      category: 'system',
      severity: 'medium',
      title: 'Cerere nouă de transport',
      description: `${dto.requesterName}${dto.companyName ? ` (${dto.companyName})` : ''} a trimis o cerere de transport prin portal.`,
    });

    // Email each org admin (stubbed). Best-effort.
    try {
      const admins = (await this.drizzleProvider.db.execute(
        sql`SELECT email FROM users
            WHERE organization_id = ${org.id}::uuid
              AND role = 'admin'::user_role
              AND deleted_at IS NULL
              AND email IS NOT NULL`,
      )) as unknown as { email: string }[];
      const tpl = messageTemplates[MessageKind.new_request_admin]({
        companyName: dto.companyName ?? null,
        requesterName: dto.requesterName,
        requesterPhone: dto.requesterPhone,
        cropType: dto.cropType ?? null,
        neededDate: dto.neededDate ?? null,
        tonsRequested: dto.tonsRequested ?? null,
        destinationAddress: dto.destinationAddress ?? null,
      });
      for (const a of admins) {
        await this.messaging.sendEmail({
          to: a.email,
          subject: tpl.subject,
          body: tpl.body,
          kind: MessageKind.new_request_admin,
          metadata: { requestId, slug },
        });
      }
    } catch (err) {
      this.winston.warn('submitPublicRequest: admin notify failed', {
        context: 'TripRequestsService',
        requestId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }

    this.winston.log('flow', `New trip request ${requestId} submitted via portal '${slug}'`, {
      context: 'TripRequestsService',
      requestId,
      slug,
    });
    return { ok: true };
  }

  // ── Beneficiary portal (public, PIN-gated) ────────────────────────────────

  async getBeneficiaryInfo(
    orgSlug: string,
    beneficiarySlug: string,
  ): Promise<PublicBeneficiaryInfo> {
    const row = await this.beneficiariesService.findBySlugPublic(orgSlug, beneficiarySlug);
    if (!row) throw new NotFoundException('Beneficiary not found');
    return {
      displayName: row.beneficiary.displayName,
      companyName: row.beneficiary.companyName,
      companyAddress: row.beneficiary.companyAddress,
      companyCui: row.beneficiary.companyCui,
      organizationName: row.org.name,
      allowedCropTypes: row.org.allowedCropTypes as CropType[],
    };
  }

  async verifyBeneficiaryPin(
    orgSlug: string,
    beneficiarySlug: string,
    pin: string,
  ): Promise<{ ok: true }> {
    const row = await this.beneficiariesService.findBySlugPublic(orgSlug, beneficiarySlug);
    if (!row || !pinEquals(row.beneficiary.dailyPin, pin)) {
      await this.pinThrottle.recordFailure(orgSlug, beneficiarySlug);
      throw new UnauthorizedException('Invalid PIN');
    }
    this.assertPinFresh(row.beneficiary.pinGeneratedAt);
    // Clear the counter only after the freshness check, so a correct-but-stale PIN
    // can't be used to reset the brute-force lockout.
    await this.pinThrottle.recordSuccess(orgSlug, beneficiarySlug);
    return { ok: true };
  }

  async submitBeneficiaryRequest(
    orgSlug: string,
    beneficiarySlug: string,
    dto: CreateBeneficiaryRequestInput,
  ): Promise<{ ok: true }> {
    const row = await this.beneficiariesService.findBySlugPublic(orgSlug, beneficiarySlug);
    if (!row || !pinEquals(row.beneficiary.dailyPin, dto.pin)) {
      await this.pinThrottle.recordFailure(orgSlug, beneficiarySlug);
      throw new UnauthorizedException('Invalid PIN');
    }
    this.assertPinFresh(row.beneficiary.pinGeneratedAt);
    // Clear the counter only after the freshness check (see verifyBeneficiaryPin).
    await this.pinThrottle.recordSuccess(orgSlug, beneficiarySlug);
    const { pin: _pin, ...fields } = dto;

    // Enforce the org's accepted crop types (parity with submitPublicRequest).
    const allowed = row.org.allowedCropTypes ?? [];
    if (fields.cropType && allowed.length && !allowed.includes(fields.cropType)) {
      throw new BadRequestException('Recoltă neacceptată.');
    }

    // Defense-in-depth: any selected saved-record ids must belong to THIS
    // beneficiary (the composite FK only enforces same-org). This both prevents a
    // crafted body from mislabeling a request with a sibling's record, and stops a
    // bad id from reaching the FK as an unhandled 23503 → 500.
    await this.assertOwnedRecords(row.org.id, row.beneficiary.id, fields);

    // Resolve the selected contacts (1..10) to their saved name/phone/email and
    // verify EVERY id belongs to this beneficiary in one round-trip. The
    // count-match below is a stronger ownership check than a per-id lookup: the
    // portal only ever sends ids (never raw addresses), so a public submission
    // can only notify this beneficiary's own saved contacts.
    const contactRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, name, phone, email FROM beneficiary_contacts
          WHERE organization_id = ${row.org.id}::uuid
            AND beneficiary_id = ${row.beneficiary.id}::uuid
            AND id IN (${sql.join(
              fields.contactIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
    )) as unknown as { id: string; name: string; phone: string | null; email: string | null }[];
    if (contactRows.length !== fields.contactIds.length) {
      throw new BadRequestException('Persoană de contact invalidă.');
    }
    // Preserve the client-picked order (Postgres IN does not) — first = primary.
    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const orderedContacts = fields.contactIds.map((id) => contactById.get(id)!);
    const primaryContact = orderedContacts[0];
    const notifyRecipients = orderedContacts.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
    }));

    const coords = fields.destinationCoords ?? null;
    const inserted = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO trip_requests (
            organization_id, status,
            requester_name, requester_phone, requester_email,
            company_name, company_address, company_cui,
            truck_registration_plate, truck_capacity_tons,
            trailer_registration_plate, transporter_name, transporter_cui, transporter_address,
            driver_name, driver_phone, driver_email,
            crop_type, quality, needed_date, tons_requested, destination_address, destination_coords, notes,
            beneficiary_id,
            contact_id, truck_id, driver_id, notify_recipients
          ) VALUES (
            ${row.org.id}::uuid, 'pending',
            ${primaryContact.name}, ${primaryContact.phone ?? fields.requesterPhone}, ${primaryContact.email ?? fields.requesterEmail ?? null},
            ${row.beneficiary.companyName}, ${row.beneficiary.companyAddress ?? null}, ${row.beneficiary.companyCui ?? null},
            ${fields.truckRegistrationPlate}, ${fields.truckCapacityTons ?? null},
            ${fields.trailerRegistrationPlate ?? null}, ${fields.transporterName ?? null}, ${fields.transporterCui ?? null}, ${fields.transporterAddress ?? null},
            ${fields.driverName}, ${fields.driverPhone}, ${fields.driverEmail ?? null},
            ${fields.cropType ? sql`${fields.cropType}::crop_type` : sql`NULL`}, ${fields.quality ?? null}, ${fields.neededDate ?? null}::date, ${fields.tonsRequested ?? null}, ${fields.destinationAddress ?? null},
            ${coords ? sql`ST_SetSRID(ST_MakePoint(${coords.lon}, ${coords.lat}), 4326)` : sql`NULL`},
            ${fields.notes ?? null},
            ${row.beneficiary.id}::uuid,
            ${fields.contactIds[0]}::uuid, ${fields.truckId ?? null}::uuid, ${fields.driverId ?? null}::uuid,
            ${JSON.stringify(notifyRecipients)}::jsonb
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    const requestId = inserted[0]?.id;

    // In-app alert for admins/dispatchers (parity with submitPublicRequest).
    await this.alertsService.create(row.org.id, {
      category: 'system',
      severity: 'medium',
      title: 'Cerere nouă de transport',
      description: `${fields.requesterName} (${row.beneficiary.companyName}) a trimis o cerere de transport prin portalul de beneficiar.`,
    });

    // Email each org admin (stubbed). Best-effort.
    try {
      const admins = (await this.drizzleProvider.db.execute(
        sql`SELECT email FROM users
            WHERE organization_id = ${row.org.id}::uuid
              AND role = 'admin'::user_role
              AND deleted_at IS NULL
              AND email IS NOT NULL`,
      )) as unknown as { email: string }[];
      const tpl = messageTemplates[MessageKind.new_request_admin]({
        companyName: row.beneficiary.companyName,
        requesterName: fields.requesterName,
        requesterPhone: fields.requesterPhone,
        cropType: fields.cropType ?? null,
        quality: fields.quality ?? null,
        neededDate: fields.neededDate ?? null,
        tonsRequested: fields.tonsRequested ?? null,
        destinationAddress: fields.destinationAddress ?? null,
      });
      for (const a of admins) {
        await this.messaging.sendEmail({
          to: a.email,
          subject: tpl.subject,
          body: tpl.body,
          kind: MessageKind.new_request_admin,
          metadata: { requestId, beneficiaryId: row.beneficiary.id },
        });
      }
    } catch (err) {
      this.winston.warn('submitBeneficiaryRequest: admin notify failed', {
        context: 'TripRequestsService',
        requestId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }

    this.winston.log(
      'flow',
      `Beneficiary request submitted: beneficiary=${row.beneficiary.id} org=${row.org.id}`,
      {
        context: 'TripRequestsService',
        beneficiaryId: row.beneficiary.id,
        orgId: row.org.id,
        tripRequestId: requestId,
      },
    );
    return { ok: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Rejects a stale daily PIN (e.g. if the 02:00 rotation cron stopped running). */
  private assertPinFresh(pinGeneratedAt: string): void {
    const age = Date.now() - new Date(pinGeneratedAt).getTime();
    if (!Number.isFinite(age) || age > PIN_MAX_AGE_MS) {
      throw new HttpException('PIN expired', HttpStatus.GONE);
    }
  }

  /**
   * Verifies any non-null saved-record id on a beneficiary submission actually
   * belongs to this (org, beneficiary). Table names are hardcoded constants.
   * Note: no `deleted_at IS NULL` filter — the flat fields are the source of truth
   * and the FK targets the PK, so a concurrently soft-deleted record still resolves.
   */
  private async assertOwnedRecords(
    orgId: string,
    beneficiaryId: string,
    fields: { truckId?: string | null; driverId?: string | null },
  ): Promise<void> {
    // Contacts are verified separately in submitBeneficiaryRequest via a
    // count-match query over the whole contactIds array (stronger than a per-id
    // check). Here we only cover the single truck / driver saved records.
    const checks: Array<{ table: string; id: string }> = [];
    if (fields.truckId) checks.push({ table: 'beneficiary_trucks', id: fields.truckId });
    if (fields.driverId) checks.push({ table: 'beneficiary_drivers', id: fields.driverId });
    for (const c of checks) {
      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT 1 FROM ${sql.raw(c.table)}
            WHERE id = ${c.id}::uuid
              AND organization_id = ${orgId}::uuid
              AND beneficiary_id = ${beneficiaryId}::uuid
            LIMIT 1`,
      )) as unknown as unknown[];
      if (!rows.length) {
        throw new BadRequestException('Înregistrare salvată invalidă.');
      }
    }
  }

  private async resolveOrgBySlug(slug: string): Promise<OrgPortalRow> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, name, request_access_code, allowed_crop_types
          FROM organizations WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`,
    )) as unknown as OrgPortalRow[];
    if (!rows.length) throw new NotFoundException('Portal inexistent.');
    return rows[0];
  }

  private async orgName(orgId: string): Promise<string> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT name FROM organizations WHERE id = ${orgId}::uuid LIMIT 1`,
    )) as unknown as { name: string }[];
    return rows[0]?.name ?? '';
  }
}
