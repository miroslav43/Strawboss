import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { GeofenceService } from './geofence.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '@strawboss/types';

@Controller('geofence')
export class GeofenceController {
  constructor(private readonly geofenceService: GeofenceService) {}

  /**
   * POST /api/v1/geofence/check
   * Admin/dispatcher: run a geofence check now instead of waiting for the
   * 5-minute job. Returns a diagnostic summary — assignments today, machines
   * with a GPS fix in the last 10 minutes, and geofence events generated — to
   * debug the full GPS → geofence → push chain on demand.
   */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.admin, UserRole.dispatcher)
  runCheck() {
    return this.geofenceService.runManualCheck();
  }
}
