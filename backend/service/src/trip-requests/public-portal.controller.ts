import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { TripRequestsService } from './trip-requests.service';
import { TripsService } from '../trips/trips.service';
import { PinThrottleGuard } from './pin-throttle.guard';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
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

// The portal code travels in the request BODY (never the URL/query) so it does
// not leak into access logs, proxies, or browser history.
const submitTripRequestSchema = createTripRequestSchema.extend({ code: portalCodeSchema });

/**
 * Unauthenticated, code-gated portal endpoints.
 *
 * NOTE: there is no rate-limiter in this backend yet (no @nestjs/throttler). The
 * 4-digit code is scoped per-slug, but a global IP throttle should be added
 * before exposing this publicly at scale — tracked in the plan's risks.
 */
@Controller('public')
export class PublicPortalController {
  constructor(
    private readonly service: TripRequestsService,
    private readonly tripsService: TripsService,
  ) {}

  @Post('portal/:slug/verify')
  @Public()
  verify(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(verifyPortalCodeSchema)) dto: { code: string },
  ) {
    return this.service.verifyPortalCode(slug, dto.code);
  }

  @Post('portal/:slug/requests')
  @Public()
  submit(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(submitTripRequestSchema))
    dto: CreateTripRequestDto & { code: string },
  ) {
    const { code, ...request } = dto;
    return this.service.submitPublicRequest(slug, code, request);
  }

  @Get('sign/:token')
  @Public()
  signInfo(@Param('token') token: string) {
    return this.tripsService.getPublicSignInfo(token);
  }

  @Post('sign/:token')
  @Public()
  sign(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signTripSchema)) dto: { signature: string },
  ) {
    return this.tripsService.signByPublicToken(token, dto.signature);
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
