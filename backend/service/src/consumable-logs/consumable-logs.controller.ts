import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ConsumableLogsService } from './consumable-logs.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createConsumableLogSchema } from '@strawboss/validation';

@Controller('consumable-logs')
export class ConsumableLogsController {
  constructor(private readonly consumableLogsService: ConsumableLogsService) {}

  @Get()
  list(
    @Query('machineId') machineId?: string,
    @Query('parcelId') parcelId?: string,
  ) {
    return this.consumableLogsService.list({ machineId, parcelId });
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createConsumableLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.consumableLogsService.create(dto);
  }
}
