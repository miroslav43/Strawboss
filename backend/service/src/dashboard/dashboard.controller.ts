import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { RequestUser } from '../auth/auth.guard';
import { SeasonsService } from '../seasons/seasons.service';

@Roles(UserRole.admin, UserRole.dispatcher)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly seasons: SeasonsService,
  ) {}

  /**
   * The window every dashboard card reads.
   *
   * One helper so the five endpoints cannot drift apart on what "no filter"
   * means. `?season` is optional everywhere and resolves server-side; an
   * organization that has never closed a season gets no filter at all, which is
   * exactly the pre-season behaviour.
   */
  private window(user: RequestUser, season?: string, dateFrom?: string, dateTo?: string) {
    return this.seasons.resolveWindow(user.organizationId, user.activeSeasonYear, {
      season: this.seasons.parseSeasonParam(season),
      dateFrom,
      dateTo,
    });
  }

  @Get('overview')
  getOverview(@CurrentUser() user: RequestUser, @Query('season') season?: string) {
    return this.dashboardService.getOverview(
      user.organizationId,
      user.role,
      this.window(user, season),
    );
  }

  @Get('production')
  getProduction(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('season') season?: string,
  ) {
    return this.dashboardService.getProduction(
      user.organizationId,
      user.role,
      this.window(user, season, dateFrom, dateTo),
    );
  }

  @Get('costs')
  getCosts(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('season') season?: string,
  ) {
    return this.dashboardService.getCosts(
      user.organizationId,
      user.role,
      this.window(user, season, dateFrom, dateTo),
    );
  }

  @Get('trending')
  getTrending(@CurrentUser() user: RequestUser) {
    // Deliberately unwindowed: this is the last-7-days sparkline, a live
    // operational strip rather than a seasonal figure. Windowing it would make
    // it render flat zero whenever an admin looks at a past season.
    return this.dashboardService.getTrending(user.organizationId, user.role);
  }

  @Get('anti-fraud')
  getAntiFraud(@CurrentUser() user: RequestUser, @Query('season') season?: string) {
    return this.dashboardService.getAntiFraud(
      user.organizationId,
      user.role,
      this.window(user, season),
    );
  }
}
