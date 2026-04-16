import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { BaleProductionsService } from './bale-productions.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBaleProductionSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('bale-productions')
export class BaleProductionsController {
  constructor(
    private readonly baleProductionsService: BaleProductionsService,
  ) {}

  @Get('stats')
  stats(
    @Query('operatorId') operatorId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy?: 'operator' | 'parcel' | 'date',
  ) {
    return this.baleProductionsService.getStats({
      operatorId,
      parcelId,
      dateFrom,
      dateTo,
      groupBy,
    });
  }

  @Get()
  list(
    @Query('operatorId') operatorId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.baleProductionsService.list({
      operatorId,
      parcelId,
      dateFrom,
      dateTo,
    });
  }

  @Post()
  @Roles('baler_operator' as UserRole, 'admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createBaleProductionSchema))
    dto: Record<string, unknown>,
  ) {
    return this.baleProductionsService.create(dto);
  }
}
