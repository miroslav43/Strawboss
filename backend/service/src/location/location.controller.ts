import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { LocationService } from './location.service';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { LocationReportDto } from '@strawboss/types';
import { UserRole } from '@strawboss/types';

@Controller('location')
@UseGuards(AuthGuard)
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
}
