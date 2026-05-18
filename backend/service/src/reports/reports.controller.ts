import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import { reportQuerySchema, type ReportQuery } from '@strawboss/validation';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

@Roles(UserRole.admin, UserRole.dispatcher)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('farms')
  getFarms(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.reportsService.getFarmReports(user.organizationId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('depots')
  getDepots(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.reportsService.getDepotReports(user.organizationId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('timeline')
  getTimeline(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.reportsService.getTimeline(
      user.organizationId,
      { dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.farmId,
    );
  }
}
