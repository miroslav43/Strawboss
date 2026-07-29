import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TripRequestsService } from './trip-requests.service';
import { TripsService } from '../trips/trips.service';
import { PinThrottleGuard } from './pin-throttle.guard';
import { TokenThrottleGuard } from './token-throttle.guard';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CMR_SCAN_MAX_BYTES } from '../uploads/uploads.service';
import {
  verifyPortalCodeSchema,
  createTripRequestSchema,
  signTripSchema,
  portalCodeSchema,
  verifyBeneficiaryPinSchema,
  createBeneficiaryRequestSchema,
} from '@strawboss/validation';
import type { CreateTripRequestDto } from '@strawboss/types';
import type { CreateBeneficiaryRequestInput } from '@strawboss/validation';

/** Accepted MIME types for an arrival-CMR upload — a phone photo or, rarer, an
 *  already-built PDF from a scanner app (see CmrScansService.saveArrivalCmrFile). */
const ARRIVAL_CMR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Same page ceiling as the loader's on-device scanner (cmrScanner.ts MAX_PAGES). */
const MAX_ARRIVAL_CMR_FILES = 10;

// The portal code travels in the request BODY (never the URL/query) so it does
// not leak into access logs, proxies, or browser history.
const submitTripRequestSchema = createTripRequestSchema.extend({ code: portalCodeSchema });

/**
 * Unauthenticated, code-gated portal endpoints.
 *
 * `verify`/`submit` carry the org-wide 4-digit access code and are brute-force
 * protected by PinThrottleGuard (per-IP request cap + per-slug lockout, keyed on
 * slug + '' since there is no beneficiarySlug on these routes) — see
 * TripRequestsService.verifyPortalCode/submitPublicRequest for the recordFailure/
 * recordSuccess wiring.
 */
@Controller('public')
export class PublicPortalController {
  constructor(
    private readonly service: TripRequestsService,
    private readonly tripsService: TripsService,
  ) {}

  @Post('portal/:slug/verify')
  @Public()
  @UseGuards(PinThrottleGuard)
  verify(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(verifyPortalCodeSchema)) dto: { code: string },
  ) {
    return this.service.verifyPortalCode(slug, dto.code);
  }

  @Post('portal/:slug/requests')
  @Public()
  @UseGuards(PinThrottleGuard)
  submit(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(submitTripRequestSchema))
    dto: CreateTripRequestDto & { code: string },
  ) {
    const { code, ...request } = dto;
    return this.service.submitPublicRequest(slug, code, request);
  }

  /** @deprecated superseded by GET cmr/:token — kept one release for stale links. */
  @Get('sign/:token')
  @Public()
  signInfo(@Param('token') token: string) {
    return this.tripsService.getPublicSignInfo(token);
  }

  /** @deprecated superseded by POST cmr/:token — kept one release for stale links. */
  @Post('sign/:token')
  @Public()
  sign(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signTripSchema)) dto: { signature: string },
  ) {
    return this.tripsService.signByPublicToken(token, dto.signature);
  }

  // ── Arrival CMR (external driver, one-time link) ───────────────────────────

  @Get('cmr/:token')
  @Public()
  cmrInfo(@Param('token') token: string) {
    return this.tripsService.getPublicArrivalCmrInfo(token);
  }

  @Post('cmr/:token')
  @Public()
  @UseGuards(TokenThrottleGuard)
  async uploadCmr(@Param('token') token: string, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const parts: { mimetype: string; buffer: Buffer }[] = [];
    let scanId: string | null = null;
    let totalBytes = 0;

    for await (const file of req.files({
      limits: { fileSize: CMR_SCAN_MAX_BYTES, files: MAX_ARRIVAL_CMR_FILES },
    })) {
      if (!ARRIVAL_CMR_MIMES.has(file.mimetype)) {
        throw new BadRequestException(`Unsupported file type '${file.mimetype}'.`);
      }
      // A `scanId` field sent ahead of the first file part (same convention as
      // CmrScansController) pins the storage filename so a retry after an
      // ambiguous failure overwrites the same blob instead of orphaning one.
      if (scanId === null) {
        const field = file.fields?.scanId;
        const value = field && !Array.isArray(field) && 'value' in field ? field.value : null;
        scanId = typeof value === 'string' ? value : null;
      }
      const buffer = await file.toBuffer();
      totalBytes += buffer.length;
      if (totalBytes > CMR_SCAN_MAX_BYTES) {
        throw new BadRequestException(`Fișierele depășesc limita de ${CMR_SCAN_MAX_BYTES} bytes.`);
      }
      parts.push({ mimetype: file.mimetype, buffer });
    }

    if (parts.length === 0) {
      throw new BadRequestException('Nicio poză primită.');
    }

    return this.tripsService.completeAuxiliaryOnArrivalCmr(token, parts, scanId);
  }

  // ── Beneficiary portal ─────────────────────────────────────────────────────

  @Get('portal/:slug/beneficiary/:beneficiarySlug')
  @Public()
  beneficiaryInfo(@Param('slug') slug: string, @Param('beneficiarySlug') beneficiarySlug: string) {
    return this.service.getBeneficiaryInfo(slug, beneficiarySlug);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/verify')
  @Public()
  @UseGuards(PinThrottleGuard)
  verifyBeneficiaryPin(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(verifyBeneficiaryPinSchema)) dto: { pin: string },
  ) {
    return this.service.verifyBeneficiaryPin(slug, beneficiarySlug, dto.pin);
  }

  @Post('portal/:slug/beneficiary/:beneficiarySlug/requests')
  @Public()
  @UseGuards(PinThrottleGuard)
  submitBeneficiaryRequest(
    @Param('slug') slug: string,
    @Param('beneficiarySlug') beneficiarySlug: string,
    @Body(new ZodValidationPipe(createBeneficiaryRequestSchema)) dto: CreateBeneficiaryRequestInput,
  ) {
    return this.service.submitBeneficiaryRequest(slug, beneficiarySlug, dto);
  }
}
