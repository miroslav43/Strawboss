import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('production')
  getProduction(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getProduction({ dateFrom, dateTo });
  }

  @Get('costs')
  getCosts(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getCosts({ dateFrom, dateTo });
  }

  @Get('trending')
  getTrending() {
    return this.dashboardService.getTrending();
  }

  @Get('anti-fraud')
  getAntiFraud() {
    return this.dashboardService.getAntiFraud();
  }
}
