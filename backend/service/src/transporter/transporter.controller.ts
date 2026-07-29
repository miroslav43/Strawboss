import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';
import { TransporterAssignmentsService } from './transporter-assignments.service';
import { TripRequestsService } from '../trip-requests/trip-requests.service';
import {
  BeneficiaryRecordsService,
  type RecordKind,
} from '../trip-requests/beneficiary-records.service';
import { CmrScansService } from '../cmr-scans/cmr-scans.service';
import { DocumentsService } from '../documents/documents.service';
import { ComandaService } from '../documents/comanda/comanda.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AVIZ_MAX_BYTES, CMR_SCAN_MAX_BYTES } from '../uploads/uploads.service';
import { DocumentType, UserRole } from '@strawboss/types';
import {
  createTransporterRequestSchema,
  beneficiaryOrderSettingsSchema,
  createBeneficiaryContactSchema,
  updateBeneficiaryContactSchema,
  createBeneficiaryTruckSchema,
  updateBeneficiaryTruckSchema,
  createBeneficiaryDriverSchema,
  updateBeneficiaryDriverSchema,
  cmrScanKindSchema,
} from '@strawboss/validation';
import type {
  CreateTransporterRequestInput,
  BeneficiaryOrderSettingsInput,
  CmrScanKind,
} from '@strawboss/validation';
import { RequireFeature } from '../features/require-feature.decorator';

/** URL segment (plural) → the service's singular RecordKind. */
const KIND_BY_SEGMENT: Record<string, RecordKind> = {
  contacts: 'contact',
  trucks: 'truck',
  drivers: 'driver',
};
const CREATE_SCHEMAS: Record<RecordKind, ZodSchema> = {
  contact: createBeneficiaryContactSchema,
  truck: createBeneficiaryTruckSchema,
  driver: createBeneficiaryDriverSchema,
};
const UPDATE_SCHEMAS: Record<RecordKind, ZodSchema> = {
  contact: updateBeneficiaryContactSchema,
  truck: updateBeneficiaryTruckSchema,
  driver: updateBeneficiaryDriverSchema,
};

/**
 * The authenticated transporter surface (UserRole.transportator only).
 *
 * Every route is scoped to the caller's org (requireOrg, fail-closed) and, for
 * anything touching a beneficiary, gated by `assertAssigned` — the auth analogue
 * of the public portal's PIN. The transporter NEVER hits the unguarded GET /trips;
 * their ledger is GET /transporter/requests, filtered server-side to the requests
 * they themselves created (trip_requests.created_by_user_id).
 */
@Controller('transporter')
@Roles(UserRole.transportator)
export class TransporterController {
  constructor(
    private readonly assignments: TransporterAssignmentsService,
    private readonly records: BeneficiaryRecordsService,
    private readonly tripRequests: TripRequestsService,
    private readonly cmrScans: CmrScansService,
    private readonly documents: DocumentsService,
    private readonly comanda: ComandaService,
  ) {}

  private async requireFile(req: FastifyRequest, maxBytes: number) {
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');
    const file = await req.file({ limits: { fileSize: maxBytes } });
    if (!file) throw new BadRequestException('Missing "file" part');
    return file;
  }

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  private resolveKind(segment: string): RecordKind {
    const kind = KIND_BY_SEGMENT[segment];
    if (!kind) throw new BadRequestException('Tip de înregistrare invalid.');
    return kind;
  }

  // ── Beneficiaries the transporter may act for ──────────────────────────────

  @Get('beneficiaries')
  listBeneficiaries(@CurrentUser() user: RequestUser) {
    return this.assignments.listAssignedBeneficiaries(this.requireOrg(user), user.id);
  }

  // ── Per-beneficiary comandă (order) settings ───────────────────────────────
  // Declared before the generic :kind routes so the static "order-settings"
  // segment is never captured as a record kind.

  @Get('beneficiaries/:beneficiaryId/order-settings')
  async getOrderSettings(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
  ) {
    const orgId = this.requireOrg(user);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    return this.assignments.getOrderSettings(orgId, beneficiaryId);
  }

  @Put('beneficiaries/:beneficiaryId/order-settings')
  @RequireFeature('portals.transporter_role')
  async putOrderSettings(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
    @Body(new ZodValidationPipe(beneficiaryOrderSettingsSchema)) dto: BeneficiaryOrderSettingsInput,
  ) {
    const orgId = this.requireOrg(user);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    return this.assignments.upsertOrderSettings(orgId, beneficiaryId, dto);
  }

  // ── Saved contacts / trucks / drivers (scoped by assertAssigned) ───────────

  @Get('beneficiaries/:beneficiaryId/:kind')
  async listRecords(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
    @Param('kind') kindSegment: string,
  ) {
    const orgId = this.requireOrg(user);
    const kind = this.resolveKind(kindSegment);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    return this.records.list(kind, orgId, beneficiaryId);
  }

  @Post('beneficiaries/:beneficiaryId/:kind')
  @RequireFeature('portals.transporter_role')
  async createRecord(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
    @Param('kind') kindSegment: string,
    @Body() body: unknown,
  ) {
    const orgId = this.requireOrg(user);
    const kind = this.resolveKind(kindSegment);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    const dto = new ZodValidationPipe(CREATE_SCHEMAS[kind]).transform(body);
    return this.records.create(kind, orgId, beneficiaryId, dto);
  }

  @Patch('beneficiaries/:beneficiaryId/:kind/:id')
  @RequireFeature('portals.transporter_role')
  async updateRecord(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
    @Param('kind') kindSegment: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const orgId = this.requireOrg(user);
    const kind = this.resolveKind(kindSegment);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    const dto = new ZodValidationPipe(UPDATE_SCHEMAS[kind]).transform(body);
    return this.records.update(kind, orgId, beneficiaryId, id, dto);
  }

  // POST-delete (not DELETE) mirrors the public portal convention.
  @Post('beneficiaries/:beneficiaryId/:kind/:id/delete')
  @RequireFeature('portals.transporter_role')
  async deleteRecord(
    @CurrentUser() user: RequestUser,
    @Param('beneficiaryId', new ParseUUIDPipe()) beneficiaryId: string,
    @Param('kind') kindSegment: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const orgId = this.requireOrg(user);
    const kind = this.resolveKind(kindSegment);
    await this.assignments.assertAssigned(orgId, user.id, beneficiaryId);
    await this.records.softDelete(kind, orgId, beneficiaryId, id);
    return { ok: true };
  }

  // ── Requests: submit + read-only ledger ────────────────────────────────────

  @Post('requests')
  @RequireFeature('portals.transporter_role')
  async submitRequest(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createTransporterRequestSchema))
    dto: CreateTransporterRequestInput,
  ) {
    const orgId = this.requireOrg(user);
    // Defense-in-depth: the beneficiary must be one the transporter is assigned to.
    await this.assignments.assertAssigned(orgId, user.id, dto.beneficiaryId);
    return this.tripRequests.submitTransporterRequest(orgId, user.id, dto);
  }

  // POST-delete (not DELETE) mirrors the beneficiary-record convention above.
  // Deletable only while the transport hasn't moved yet — TripRequestsService
  // re-derives the stage server-side and refuses otherwise (stage_not_deletable).
  @Post('requests/:id/delete')
  @RequireFeature('portals.transporter_role')
  async deleteRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    await this.tripRequests.deleteAuxRequest(orgId, id);
    return { ok: true };
  }

  @Get('requests')
  listRequests(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.tripRequests.list(this.requireOrg(user), {
      status,
      search,
      dateFrom,
      dateTo,
      createdByUserId: user.id,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // ── Documents: aviz + CMR, only on the transporter's OWN requests ──────────
  // Every handler first asserts the request was created by this transporter, so
  // a transporter can only see/upload documents for their own transports.

  @Get('requests/:id/aviz')
  async listAviz(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    return this.tripRequests.listAvize(orgId, id);
  }

  @Post('requests/:id/aviz')
  @RequireFeature('portals.transporter_role')
  async uploadAviz(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    const file = await this.requireFile(req, AVIZ_MAX_BYTES);
    return this.tripRequests.uploadAviz(orgId, id, {
      mimetype: file.mimetype,
      filename: file.filename,
      stream: file.file,
    });
  }

  @Get('requests/:id/cmr')
  async listCmr(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('kind', new ZodValidationPipe(cmrScanKindSchema)) kind: CmrScanKind,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    return this.cmrScans.listForRequest(orgId, id, kind);
  }

  @Post('requests/:id/cmr')
  @RequireFeature('portals.transporter_role')
  async uploadCmr(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('kind', new ZodValidationPipe(cmrScanKindSchema)) kind: CmrScanKind,
    @Req() req: FastifyRequest,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    const file = await this.requireFile(req, CMR_SCAN_MAX_BYTES);
    return this.cmrScans.uploadForRequest(
      orgId,
      id,
      {
        mimetype: file.mimetype,
        stream: file.file,
        pageCount: null,
        scanId: null,
        source: 'admin_upload',
      },
      kind,
    );
  }

  // ── Comandă (generated transport order) — view + regenerate, own requests ──

  @Get('requests/:id/comanda')
  async listComanda(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    return this.documents.list(orgId, 'system', {
      tripRequestId: id,
      documentType: DocumentType.comanda,
    });
  }

  @Post('requests/:id/comanda')
  @RequireFeature('portals.transporter_role', 'documents.comanda')
  async generateComanda(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const orgId = this.requireOrg(user);
    await this.tripRequests.assertCreatedBy(orgId, id, user.id);
    const doc = await this.comanda.generateComanda(orgId, id);
    if (!doc) {
      // Generation is a no-op when the beneficiary has no order settings — tell
      // the user how to fix it instead of returning a silent empty success.
      throw new BadRequestException(
        'Completați mai întâi datele de comandă pentru acest beneficiar în tab-ul „Beneficiari”, apoi generați comanda.',
      );
    }
    return doc;
  }
}
