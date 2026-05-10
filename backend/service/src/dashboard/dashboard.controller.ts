import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getOverview(user.organizationId);
  }

  @Get('production')
  getProduction(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getProduction(user.organizationId, { dateFrom, dateTo });
  }

  @Get('costs')
  getCosts(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getCosts(user.organizationId, { dateFrom, dateTo });
  }

  @Get('trending')
  getTrending(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getTrending(user.organizationId);
  }

  @Get('anti-fraud')
  getAntiFraud(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getAntiFraud(user.organizationId);
  }
}
