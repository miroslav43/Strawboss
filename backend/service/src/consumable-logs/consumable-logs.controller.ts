import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ConsumableLogsService } from './consumable-logs.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createConsumableLogSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('consumable-logs')
export class ConsumableLogsController {
  constructor(private readonly consumableLogsService: ConsumableLogsService) {}

  @Get('stats')
  getStats(
    @Query('operatorId') operatorId?: string,
    @Query('consumableType') consumableType?: string,
  ) {
    return this.consumableLogsService.getStats({ operatorId, consumableType });
  }

  @Get()
  list(
    @Query('machineId') machineId?: string,
    @Query('parcelId') parcelId?: string,
  ) {
    return this.consumableLogsService.list({ machineId, parcelId });
  }

  @Post()
  @Roles('admin' as UserRole, 'baler_operator' as UserRole, 'loader_operator' as UserRole, 'driver' as UserRole)
  create(
    @Body(new ZodValidationPipe(createConsumableLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.consumableLogsService.create(dto);
  }
}
