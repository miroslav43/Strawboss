import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { RequestUser } from '../auth/auth.guard';

@Roles(UserRole.admin, UserRole.dispatcher)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getOverview(user.organizationId, user.role);
  }

  @Get('production')
  getProduction(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getProduction(user.organizationId, user.role, {
      dateFrom,
      dateTo,
    });
  }

  @Get('costs')
  getCosts(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getCosts(user.organizationId, user.role, { dateFrom, dateTo });
  }

  @Get('trending')
  getTrending(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getTrending(user.organizationId, user.role);
  }

  @Get('anti-fraud')
  getAntiFraud(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getAntiFraud(user.organizationId, user.role);
  }
}
