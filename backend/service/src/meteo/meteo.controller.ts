import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MeteoService } from './meteo.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireFeature } from '../features/require-feature.decorator';
import {
  createHarvestEventSchema,
  createMoistureReadingSchema,
  meteoParcelQuerySchema,
  updateHarvestEventSchema,
  updateMeteoSettingsSchema,
} from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import type {
  CreateHarvestEventDto,
  CreateMoistureReadingDto,
  UpdateHarvestEventDto,
  UpdateMeteoSettingsDto,
} from '@strawboss/types';

/**
 * Baling-window forecast. Every route is org-scoped (requireOrg, fail-closed).
 * Reads carry no @RequireFeature (existing data stays visible); every write has
 * its feature key AND an org opt-in check inside the service
 * (FEATURE_DISABLED 403) — except PUT /settings, which IS the opt-in.
 */
@Controller('meteo')
export class MeteoController {
  constructor(private readonly service: MeteoService) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get('status')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.baler_operator, UserRole.loader_operator)
  status(@CurrentUser() user: RequestUser) {
    return this.service.getStatus(this.requireOrg(user), user.disabledFeatures);
  }

  @Get('settings')
  @Roles(UserRole.admin, UserRole.dispatcher)
  settings(@CurrentUser() user: RequestUser) {
    return this.service.getSettings(this.requireOrg(user));
  }

  @Put('settings')
  @RequireFeature('meteo')
  @Roles(UserRole.admin)
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateMeteoSettingsSchema)) dto: UpdateMeteoSettingsDto,
  ) {
    return this.service.updateSettings(this.requireOrg(user), user.id, dto);
  }

  @Get('overview')
  @Roles(UserRole.admin, UserRole.dispatcher)
  overview(@CurrentUser() user: RequestUser) {
    return this.service.getOverview(this.requireOrg(user));
  }

  @Get('parcels/:parcelId')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.baler_operator, UserRole.loader_operator)
  parcel(
    @CurrentUser() user: RequestUser,
    @Param('parcelId', new ParseUUIDPipe()) parcelId: string,
    @Query(new ZodValidationPipe(meteoParcelQuerySchema)) query: { hours?: number },
  ) {
    return this.service.getParcelDetail(this.requireOrg(user), parcelId, query.hours);
  }

  @Get('parcels/:parcelId/readings')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.baler_operator, UserRole.loader_operator)
  readings(
    @CurrentUser() user: RequestUser,
    @Param('parcelId', new ParseUUIDPipe()) parcelId: string,
  ) {
    return this.service.listReadings(this.requireOrg(user), parcelId);
  }

  @Post('harvest-events')
  @RequireFeature('meteo.window')
  @Roles(UserRole.admin, UserRole.dispatcher)
  createHarvestEvent(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createHarvestEventSchema)) dto: CreateHarvestEventDto,
  ) {
    return this.service.createHarvestEvent(this.requireOrg(user), user.id, dto);
  }

  @Patch('harvest-events/:id')
  @RequireFeature('meteo.window')
  @Roles(UserRole.admin, UserRole.dispatcher)
  updateHarvestEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateHarvestEventSchema)) dto: UpdateHarvestEventDto,
  ) {
    return this.service.updateHarvestEvent(this.requireOrg(user), id, dto);
  }

  @Post('harvest-events/:id/close')
  @RequireFeature('meteo.window')
  @Roles(UserRole.admin, UserRole.dispatcher)
  closeHarvestEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.closeHarvestEvent(this.requireOrg(user), id);
  }

  @Post('readings')
  @RequireFeature('meteo.moisture')
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.baler_operator, UserRole.loader_operator)
  createReading(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createMoistureReadingSchema)) dto: CreateMoistureReadingDto,
  ) {
    return this.service.createReading(this.requireOrg(user), user.id, dto);
  }

  @Delete('readings/:id')
  @RequireFeature('meteo.moisture')
  @Roles(UserRole.admin, UserRole.dispatcher)
  deleteReading(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deleteReading(this.requireOrg(user), id);
  }

  @Get('fingerprints')
  @Roles(UserRole.admin, UserRole.dispatcher)
  fingerprints(
    @CurrentUser() user: RequestUser,
    @Query('parcelId', new ParseUUIDPipe({ optional: true })) parcelId?: string,
  ) {
    return this.service.listFingerprints(this.requireOrg(user), parcelId);
  }

  @Get('fingerprints/:baleProductionId')
  @Roles(UserRole.admin, UserRole.dispatcher)
  fingerprint(
    @CurrentUser() user: RequestUser,
    @Param('baleProductionId', new ParseUUIDPipe()) baleProductionId: string,
  ) {
    return this.service.getFingerprint(this.requireOrg(user), baleProductionId);
  }

  @Post('recompute')
  @RequireFeature('meteo')
  @Roles(UserRole.admin)
  recompute(@CurrentUser() user: RequestUser) {
    return this.service.recompute(this.requireOrg(user));
  }
}
