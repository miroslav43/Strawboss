import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser, Roles, type RequestUser } from '../../auth';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { meteoWeatherQuerySchema, type MeteoWeatherQuery } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import { MeteoFarmWeatherService } from './meteo-farm-weather.service';
import { MeteoWeatherService } from './meteo-weather.service';

/**
 * Interactive weather (live Open-Meteo, cached in Redis). Reads carry no
 * @RequireFeature — assertWeatherAccess() is fail-closed instead, because
 * every miss spends external quota.
 */
@Controller('meteo')
export class MeteoWeatherController {
  constructor(
    private readonly weather: MeteoWeatherService,
    private readonly farm: MeteoFarmWeatherService,
  ) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get('parcels/:parcelId/weather')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.baler_operator, UserRole.loader_operator)
  async parcelWeather(
    @CurrentUser() user: RequestUser,
    @Param('parcelId', new ParseUUIDPipe()) parcelId: string,
    @Query(new ZodValidationPipe(meteoWeatherQuerySchema)) query: MeteoWeatherQuery,
  ) {
    const orgId = this.requireOrg(user);
    await this.weather.assertWeatherAccess(orgId, user.disabledFeatures);
    return this.weather.getParcelWeather(orgId, parcelId, query.view ?? 'full');
  }

  @Get('farm-weather')
  @Roles(UserRole.admin, UserRole.dispatcher)
  async farmWeather(@CurrentUser() user: RequestUser) {
    const orgId = this.requireOrg(user);
    await this.weather.assertWeatherAccess(orgId, user.disabledFeatures);
    return this.farm.getFarmWeather(orgId);
  }
}
