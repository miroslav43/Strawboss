import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { BaleProductionsService } from './bale-productions.service';
import { SeasonsService } from '../seasons/seasons.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBaleProductionSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { RequireFeature } from '../features/require-feature.decorator';

@Controller('bale-productions')
export class BaleProductionsController {
  constructor(
    private readonly baleProductionsService: BaleProductionsService,
    private readonly seasons: SeasonsService,
  ) {}

  @Get('stats')
  stats(
    @CurrentUser() user: RequestUser,
    @Query('operatorId') operatorId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('balerId') balerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy?: 'operator' | 'parcel' | 'date',
  ) {
    return this.baleProductionsService.getStats(user.organizationId, {
      operatorId,
      parcelId,
      balerId,
      dateFrom,
      dateTo,
      groupBy,
    });
  }

  /** Bales per baler machine, with a nested per-operator breakdown. */
  @Get('machine-stats')
  machineStats(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.baleProductionsService.getMachineOperatorProduction(user.organizationId, {
      dateFrom,
      dateTo,
    });
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('operatorId') operatorId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('balerId') balerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.baleProductionsService.list(user.organizationId, {
      operatorId,
      parcelId,
      balerId,
      dateFrom,
      dateTo,
    });
  }

  @Post()
  @RequireFeature('bales.production')
  @Roles('baler_operator' as UserRole, 'admin' as UserRole)
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createBaleProductionSchema))
    dto: Record<string, unknown>,
  ) {
    // The one write in the system that carries a CLIENT-CHOSEN business date,
    // so the only one that can land in an already-closed season by accident (or
    // on purpose). Every other table stamps its date server-side with NOW(),
    // which by construction falls in a season that is still open.
    if (typeof dto.productionDate === 'string') {
      await this.seasons.assertSeasonWritable(user.organizationId, dto.productionDate);
    }
    return this.baleProductionsService.create(user.organizationId!, dto);
  }

  @Delete(':id')
  @RequireFeature('bales.production')
  @Roles('admin' as UserRole)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.baleProductionsService.softDelete(id, user.organizationId);
  }
}
