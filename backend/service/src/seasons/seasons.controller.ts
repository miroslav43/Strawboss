import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  UserRole,
  type CloseSeasonResult,
  type SeasonContext,
  type SeasonPreflight,
} from '@strawboss/types';
import { closeSeasonSchema } from '@strawboss/validation';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SeasonsService } from './seasons.service';

/**
 * The organization's own season controls.
 *
 * ── WHY A DEDICATED CONTROLLER ──────────────────────────────────────────────
 *
 * `RolesGuard` treats a method with no `@Roles` as open to every authenticated
 * role, and `OrganizationsController` carries no class-level decorator — every
 * method declares its own. Putting "freeze a year of this farm's numbers" there
 * would leave it one forgotten decorator away from being callable by any driver
 * on any fleet phone. The class-level `@Roles` here makes that impossible.
 *
 * ── WHY THIS IS NOT BEHIND A FEATURE FLAG ───────────────────────────────────
 *
 * `scripts/check-features.mjs` requires every backend write route to be gated
 * or explicitly exempt, and this one is exempt on purpose. Seasons are in the
 * same category as auth, the trip state machine and sync: switching them off
 * would not remove a product module, it would strand an organization in a year
 * it can never leave. The registry's own header states the rule — a flag is a
 * PRODUCT gate, never something that can brick an organization.
 */
@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) {
      // A super_admin lives outside every organization and therefore has no
      // season of its own. It reads across tenants unfiltered; there is nothing
      // here for it to close.
      throw new ForbiddenException('Această acțiune necesită o organizație');
    }
    return user.organizationId;
  }

  /**
   * GET /api/v1/seasons
   *
   * Open to every authenticated role, because it is a READ and because the
   * clients need it to label what they are showing. Only `admin` can act on it
   * — that gate is on the two routes below, not on knowing which year it is.
   */
  @Get()
  async context(@CurrentUser() user: RequestUser): Promise<SeasonContext> {
    return this.seasonsService.getContext(this.requireOrg(user), user.activeSeasonYear);
  }

  /**
   * GET /api/v1/seasons/:year/preflight
   *
   * Performs ZERO writes and returns exactly the counts the close would
   * produce, so the confirmation screen cannot promise something different
   * from what happens.
   */
  @Get(':year/preflight')
  @Roles(UserRole.admin)
  async preflight(
    @CurrentUser() user: RequestUser,
    @Param('year') year: string,
  ): Promise<SeasonPreflight> {
    const parsed = this.seasonsService.parseSeasonParam(year);
    if (parsed === undefined) {
      throw new BadRequestException({ error: 'invalid_season', message: 'Sezon lipsă.' });
    }
    return this.seasonsService.preflight(this.requireOrg(user), parsed);
  }

  /**
   * POST /api/v1/seasons/close
   *
   * Freezes a finished calendar year: snapshots per-parcel seasonal state,
   * carries depot stock forward as an opening balance, resets harvest status
   * and comandă numbering, and moves the organization's read default to the
   * next year.
   *
   * Nothing is deleted. The season becomes read-only, and every past season
   * stays fully readable through the season selector.
   */
  @Post('close')
  @Roles(UserRole.admin)
  async close(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(closeSeasonSchema)) dto: { year: number; reason: string },
  ): Promise<CloseSeasonResult> {
    return this.seasonsService.close(this.requireOrg(user), dto.year, dto.reason, {
      userId: user.id,
      role: user.role,
    });
  }
}
