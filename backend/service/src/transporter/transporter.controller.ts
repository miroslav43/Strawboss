import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { TransporterAssignmentsService } from './transporter-assignments.service';
import { TripRequestsService } from '../trip-requests/trip-requests.service';
import {
  BeneficiaryRecordsService,
  type RecordKind,
} from '../trip-requests/beneficiary-records.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UserRole } from '@strawboss/types';
import {
  createTransporterRequestSchema,
  createBeneficiaryContactSchema,
  updateBeneficiaryContactSchema,
  createBeneficiaryTruckSchema,
  updateBeneficiaryTruckSchema,
  createBeneficiaryDriverSchema,
  updateBeneficiaryDriverSchema,
} from '@strawboss/validation';
import type { CreateTransporterRequestInput } from '@strawboss/validation';

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
  ) {}

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
}
