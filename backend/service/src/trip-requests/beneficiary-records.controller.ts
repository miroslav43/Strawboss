import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { BeneficiaryRecordsService } from './beneficiary-records.service';
import { BeneficiaryPinVerifier } from './beneficiary-pin.verifier';
import { PinThrottleGuard } from './pin-throttle.guard';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  portalPinSchema,
  verifyBeneficiaryPinSchema,
  createBeneficiaryContactSchema,
  updateBeneficiaryContactSchema,
  createBeneficiaryTruckSchema,
  updateBeneficiaryTruckSchema,
  createBeneficiaryDriverSchema,
  updateBeneficiaryDriverSchema,
} from '@strawboss/validation';
import type {
  CreateBeneficiaryContactInput,
  UpdateBeneficiaryContactInput,
  CreateBeneficiaryTruckInput,
  UpdateBeneficiaryTruckInput,
  CreateBeneficiaryDriverInput,
  UpdateBeneficiaryDriverInput,
} from '@strawboss/validation';

// The 4-digit PIN travels in the request BODY (never the URL/query) — same rule as
// the rest of the portal (see public-portal.controller.ts:18). Create/update bodies
// carry the entity fields + pin; list/delete bodies carry only { pin }.
const pinBody = verifyBeneficiaryPinSchema;
const createContactBody = createBeneficiaryContactSchema.extend({ pin: portalPinSchema });
const updateContactBody = updateBeneficiaryContactSchema.extend({ pin: portalPinSchema });
const createTruckBody = createBeneficiaryTruckSchema.extend({ pin: portalPinSchema });
const updateTruckBody = updateBeneficiaryTruckSchema.extend({ pin: portalPinSchema });
const createDriverBody = createBeneficiaryDriverSchema.extend({ pin: portalPinSchema });
const updateDriverBody = updateBeneficiaryDriverSchema.extend({ pin: portalPinSchema });

/**
 * Public, PIN-gated CRUD for the per-beneficiary saved Contacts / Trucks / Drivers
 * shown as dropdowns on the request portal. Every handler resolves org+beneficiary
 * from the slugs and re-verifies the daily PIN via BeneficiaryPinVerifier before
 * touching data; PinThrottleGuard enforces the per-IP / lockout limits.
 */
@Controller('public')
export class BeneficiaryRecordsController {
  constructor(
    private readonly records: BeneficiaryRecordsService,
    private readonly verifier: BeneficiaryPinVerifier,
  ) {}

  // ── Contacts ───────────────────────────────────────────────────────────────

  @Post('portal/:slug/beneficiary/:beneficiarySlug/contacts/list')
  @Public()
  @UseGuards(PinThrottleGuard)
  async listContacts(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    return this.records.list('contact', row.org.id, row.beneficiary.id);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/contacts')
  @Public()
  @UseGuards(PinThrottleGuard)
  async createContact(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(createContactBody))
    dto: CreateBeneficiaryContactInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.create('contact', row.org.id, row.beneficiary.id, fields);
  }

  @Patch('portal/:slug/beneficiary/:beneficiarySlug/contacts/:id')
  @Public()
  @UseGuards(PinThrottleGuard)
  async updateContact(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateContactBody))
    dto: UpdateBeneficiaryContactInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.update('contact', row.org.id, row.beneficiary.id, id, fields);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/contacts/:id/delete')
  @Public()
  @UseGuards(PinThrottleGuard)
  async deleteContact(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    await this.records.softDelete('contact', row.org.id, row.beneficiary.id, id);
    return { ok: true };
  }

  // ── Trucks (+ transporter) ───────────────────────────────────────────────────

  @Post('portal/:slug/beneficiary/:beneficiarySlug/trucks/list')
  @Public()
  @UseGuards(PinThrottleGuard)
  async listTrucks(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    return this.records.list('truck', row.org.id, row.beneficiary.id);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/trucks')
  @Public()
  @UseGuards(PinThrottleGuard)
  async createTruck(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(createTruckBody))
    dto: CreateBeneficiaryTruckInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.create('truck', row.org.id, row.beneficiary.id, fields);
  }

  @Patch('portal/:slug/beneficiary/:beneficiarySlug/trucks/:id')
  @Public()
  @UseGuards(PinThrottleGuard)
  async updateTruck(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateTruckBody))
    dto: UpdateBeneficiaryTruckInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.update('truck', row.org.id, row.beneficiary.id, id, fields);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/trucks/:id/delete')
  @Public()
  @UseGuards(PinThrottleGuard)
  async deleteTruck(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    await this.records.softDelete('truck', row.org.id, row.beneficiary.id, id);
    return { ok: true };
  }

  // ── Drivers ──────────────────────────────────────────────────────────────────

  @Post('portal/:slug/beneficiary/:beneficiarySlug/drivers/list')
  @Public()
  @UseGuards(PinThrottleGuard)
  async listDrivers(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    return this.records.list('driver', row.org.id, row.beneficiary.id);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/drivers')
  @Public()
  @UseGuards(PinThrottleGuard)
  async createDriver(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(createDriverBody))
    dto: CreateBeneficiaryDriverInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.create('driver', row.org.id, row.beneficiary.id, fields);
  }

  @Patch('portal/:slug/beneficiary/:beneficiarySlug/drivers/:id')
  @Public()
  @UseGuards(PinThrottleGuard)
  async updateDriver(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateDriverBody))
    dto: UpdateBeneficiaryDriverInput & { pin: string },
  ) {
    const { pin, ...fields } = dto;
    const row = await this.verifier.verify(slug, beneficiarySlug, pin);
    return this.records.update('driver', row.org.id, row.beneficiary.id, id, fields);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/drivers/:id/delete')
  @Public()
  @UseGuards(PinThrottleGuard)
  async deleteDriver(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(pinBody)) dto: { pin: string },
  ) {
    const row = await this.verifier.verify(slug, beneficiarySlug, dto.pin);
    await this.records.softDelete('driver', row.org.id, row.beneficiary.id, id);
    return { ok: true };
  }
}
