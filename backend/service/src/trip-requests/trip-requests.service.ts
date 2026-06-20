import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { AlertsService } from '../alerts/alerts.service';
import { MESSAGING_SERVICE, type IMessagingService } from '../messaging/messaging.tokens';
import { messageTemplates } from '../messaging/message-templates';
import { MessageKind, RequestStatus } from '@strawboss/types';
import type { TripRequest, PortalInfo, CreateTripRequestDto } from '@strawboss/types';

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
  created_at               AS "createdAt",
  updated_at               AS "updatedAt",
  deleted_at               AS "deletedAt"
`;

interface OrgPortalRow {
  id: string;
  name: string;
  request_access_code: string | null;
  allowed_crop_types: string[] | null;
}

@Injectable()
export class TripRequestsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly alertsService: AlertsService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
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
  async confirm(orgId: string | null, id: string, userId: string, internalCode?: string) {
    const req = await this.findById(orgId, id);
    if (req.status !== RequestStatus.pending) {
      throw new BadRequestException('Cererea a fost deja procesată.');
    }
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

    // Notify the requester (stubbed). Best-effort.
    if (req.requesterEmail) {
      const orgName = await this.orgName(req.organizationId);
      const tpl = messageTemplates[MessageKind.request_confirmed_requester]({
        organizationName: orgName,
        requesterName: req.requesterName,
        neededDate: req.neededDate,
      });
      void this.messaging
        .sendEmail({
          to: req.requesterEmail,
          subject: tpl.subject,
          body: tpl.body,
          kind: MessageKind.request_confirmed_requester,
          metadata: { requestId: id },
        })
        .catch(() => undefined);
    }

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
            truck_registration_plate, truck_make, truck_model, truck_capacity_tons,
            driver_name, driver_phone, driver_email,
            crop_type, needed_date, tons_requested,
            destination_address, destination_locality, destination_coords, notes
          ) VALUES (
            ${org.id}::uuid, ${dto.requesterName}, ${dto.requesterPhone}, ${dto.requesterEmail ?? null},
            ${dto.companyName ?? null}, ${dto.companyAddress ?? null}, ${dto.companyCui ?? null},
            ${dto.truckRegistrationPlate}, ${dto.truckMake ?? null}, ${dto.truckModel ?? null}, ${dto.truckCapacityTons ?? null},
            ${dto.driverName}, ${dto.driverPhone}, ${dto.driverEmail ?? null},
            ${dto.cropType ? sql`${dto.cropType}::crop_type` : sql`NULL`}, ${dto.neededDate ?? null}, ${dto.tonsRequested ?? null},
            ${dto.destinationAddress ?? null}, ${dto.destinationLocality ?? null},
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

  // ── helpers ────────────────────────────────────────────────────────────────

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
