import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

@Roles(UserRole.admin, UserRole.dispatcher)
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
