import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@strawboss/types';
import {
  reportQuerySchema,
  type ReportQuery,
  truckDistanceQuerySchema,
  type TruckDistanceQuery,
  connectedHoursQuerySchema,
  type ConnectedHoursQuery,
} from '@strawboss/validation';
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

  /**
   * T18 — bulk per-truck-per-day distance from the GPS trace.
   * Query: `from`, `to` (inclusive ISO dates), optional `machineId`.
   */
  @Get('truck-distance')
  getTruckDistance(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(truckDistanceQuerySchema)) query: TruckDistanceQuery,
  ) {
    return this.reportsService.getTruckDistance(user.organizationId, query);
  }

  /** T18 — "today / this week" per-truck km summary for the Machines admin page. */
  @Get('truck-distance/summary')
  getTruckDistanceSummary(@CurrentUser() user: RequestUser) {
    return this.reportsService.getTruckDistanceSummary(user.organizationId);
  }

  /**
   * Plan A T4 — connected-hours report aggregated from user_sessions.
   * Both paths are registered via a single decorator: stacking two `@Get()`
   * decorators does NOT register both routes — NestJS's RequestMapping calls
   * `Reflect.defineMetadata(PATH_METADATA, …)`, so the topmost decorator
   * overwrites the lower one (which previously 404'd `connected-hours`).
   */
  @Get(['connected-hours', 'user-connected-hours'])
  getConnectedHours(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(connectedHoursQuerySchema)) query: ConnectedHoursQuery,
  ) {
    return this.reportsService.getConnectedHours(user.organizationId, query);
  }
}
