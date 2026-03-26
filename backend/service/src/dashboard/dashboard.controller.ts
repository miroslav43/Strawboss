import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('production')
  getProduction() {
    return this.dashboardService.getProduction();
  }

  @Get('costs')
  getCosts() {
    return this.dashboardService.getCosts();
  }

  @Get('anti-fraud')
  getAntiFraud() {
    return this.dashboardService.getAntiFraud();
  }
}
