import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { BaleProductionsService } from './bale-productions.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBaleProductionSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('bale-productions')
export class BaleProductionsController {
  constructor(private readonly baleProductionsService: BaleProductionsService) {}

  @Get('stats')
  stats(
    @CurrentUser() user: RequestUser,
    @Query('operatorId') operatorId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy?: 'operator' | 'parcel' | 'date',
  ) {
    return this.baleProductionsService.getStats(user.organizationId, {
      operatorId,
      parcelId,
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
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.baleProductionsService.list(user.organizationId, {
      operatorId,
      parcelId,
      dateFrom,
      dateTo,
    });
  }

  @Post()
  @Roles('baler_operator' as UserRole, 'admin' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createBaleProductionSchema))
    dto: Record<string, unknown>,
  ) {
    return this.baleProductionsService.create(user.organizationId!, dto);
  }
}
