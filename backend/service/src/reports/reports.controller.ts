import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('farms')
  getFarms(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getFarmReports(user.organizationId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('depots')
  getDepots(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getDepotReports(user.organizationId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('timeline')
  getTimeline(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('farmId') farmId?: string,
  ) {
    return this.reportsService.getTimeline(
      user.organizationId,
      { dateFrom, dateTo },
      farmId || undefined,
    );
  }
}
