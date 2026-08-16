import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { DeliveryDestinationsService } from './delivery-destinations.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createDeliveryDestinationSchema,
  updateDeliveryDestinationSchema,
} from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { RequireFeature } from '../features/require-feature.decorator';
import { SeasonsService } from '../seasons/seasons.service';

@Controller('delivery-destinations')
export class DeliveryDestinationsController {
  constructor(
    private readonly service: DeliveryDestinationsService,
    private readonly seasons: SeasonsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('isActive') isActive?: string,
    @Query('season') season?: string,
  ) {
    const filters: { isActive?: boolean } = {};
    if (isActive === 'true') filters.isActive = true;
    if (isActive === 'false') filters.isActive = false;
    // `?season` is optional everywhere: omitted, it resolves to the org's
    // active season, so a client that knows nothing about seasons — an old APK,
    // a bookmarked URL — keeps working and simply sees the current year.
    const seasonYear = this.seasons.resolveYear(user.organizationId, user.activeSeasonYear, {
      season: this.seasons.parseSeasonParam(season),
    });
    return this.service.list(user.organizationId, filters, seasonYear);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.findById(id, user.organizationId);
  }

  @Post()
  @RequireFeature('depot.destinations')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createDeliveryDestinationSchema))
    dto: Record<string, unknown>,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  @RequireFeature('depot.destinations')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateDeliveryDestinationSchema))
    dto: Record<string, unknown>,
  ) {
    return this.service.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @RequireFeature('depot.destinations')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.softDelete(id, user.organizationId);
  }
}
