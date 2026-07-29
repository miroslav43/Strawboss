import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  BeneficiariesService,
  type OrgBeneficiaryRow,
} from '../beneficiaries/beneficiaries.service';
import { PinThrottleService } from './pin-throttle.service';
import { pinEquals, PIN_MAX_AGE_MS } from './trip-requests.service';
import { FeaturesService } from '../features/features.service';

/**
 * Single source of truth for the public beneficiary-portal security gate, shared
 * by every PIN-gated CRUD endpoint (contacts/trucks/drivers). Mirrors exactly the
 * gate used by `submitBeneficiaryRequest`:
 *   1. resolve org + beneficiary from the URL slugs (never trust client ids),
 *   2. constant-time PIN check (failure feeds the brute-force lockout counter),
 *   3. reject a stale daily PIN (410).
 *
 * The per-IP / lockout assertion is handled separately by `PinThrottleGuard` on
 * each route, identical to the existing portal endpoints.
 */
@Injectable()
export class BeneficiaryPinVerifier {
  constructor(
    private readonly beneficiaries: BeneficiariesService,
    private readonly throttle: PinThrottleService,
    private readonly features: FeaturesService,
  ) {}

  async verify(orgSlug: string, beneficiarySlug: string, pin: string): Promise<OrgBeneficiaryRow> {
    const row = await this.beneficiaries.findBySlugPublic(orgSlug, beneficiarySlug);
    if (!row || !pinEquals(row.beneficiary.dailyPin, pin)) {
      await this.throttle.recordFailure(orgSlug, beneficiarySlug);
      throw new UnauthorizedException('Invalid PIN');
    }
    const age = Date.now() - new Date(row.beneficiary.pinGeneratedAt).getTime();
    if (!Number.isFinite(age) || age > PIN_MAX_AGE_MS) {
      throw new HttpException('PIN expired', HttpStatus.GONE);
    }
    // Clear the brute-force counter only once the PIN is both correct AND fresh —
    // otherwise a correct-but-stale PIN (cron stopped >48h) would reset the lockout.
    await this.throttle.recordSuccess(orgSlug, beneficiarySlug);
    /*
     * Feature gate for the whole beneficiary portal.
     *
     * Every one of the twelve PIN-gated CRUD routes funnels through here, and
     * they are all @Public() — FeaturesGuard never sees a request.user, so this
     * is the only place the check can live once and cover them all. Placed
     * after the PIN check so a switched-off portal does not become an oracle
     * for guessing which beneficiary slugs exist.
     */
    await this.features.assertEnabledForOrg(row.org.id, 'portals.beneficiary_pin');
    return row;
  }
}
