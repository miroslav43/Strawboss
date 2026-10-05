import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, Roles, type RequestUser } from '../../auth';
import { UserRole } from '@strawboss/types';
import { MeteoClimateService } from './meteo-climate.service';

/** Climate normals / anomalies. A read, so no @RequireFeature — the service gates (fail-closed). */
@Controller('meteo')
export class MeteoClimateController {
  constructor(private readonly service: MeteoClimateService) {}

  @Get('parcels/:parcelId/climate')
  @Roles(UserRole.admin, UserRole.dispatcher)
  climate(
    @CurrentUser() user: RequestUser,
    @Param('parcelId', new ParseUUIDPipe()) parcelId: string,
  ) {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return this.service.getParcelClimate(user.organizationId, parcelId, user.disabledFeatures);
  }
}
