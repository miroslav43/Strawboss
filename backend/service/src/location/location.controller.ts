import { Controller, Post, Get, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { LocationService } from './location.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { LocationReportDto } from '@strawboss/types';
import { UserRole } from '@strawboss/types';

@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /**
   * POST /api/v1/location/report
   * Any authenticated operator (baler, loader, driver) sends their GPS position.
   */
  @Post('report')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(
    @Body() dto: LocationReportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.locationService.reportLocation(dto, user.id);
  }

  /**
   * GET /api/v1/location/machines
   * Admin-only: last known GPS position for every machine.
   */
  @Get('machines')
  @Roles(UserRole.admin)
  getLastKnownPositions() {
    return this.locationService.getLastKnownPositions();
  }

  /**
   * GET /api/v1/location/related-machines
   * Any authenticated user: last known positions of machines that share
   * today's task assignments with the current user (e.g. a loader's trucks).
   */
  @Get('related-machines')
  getRelatedMachineLocations(@CurrentUser() user: RequestUser) {
    return this.locationService.getRelatedMachineLocations(user.id);
  }

  /**
   * GET /api/v1/location/machines/:machineId/route?from=...&to=...
   * Admin-only: GPS route history for a specific machine within a time range.
   */
  @Get('machines/:machineId/route')
  @Roles(UserRole.admin)
  getRouteHistory(
    @Param('machineId') machineId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.locationService.getRouteHistory(machineId, from, to);
  }
}
