import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FuelLogsService } from './fuel-logs.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createFuelLogSchema } from '@strawboss/validation';

@Controller('fuel-logs')
export class FuelLogsController {
  constructor(private readonly fuelLogsService: FuelLogsService) {}

  @Get('stats')
  getStats(
    @Query('operatorId') operatorId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.fuelLogsService.getStats({ operatorId, machineId, dateFrom, dateTo });
  }

  @Get()
  list(
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.fuelLogsService.list({ machineId, dateFrom, dateTo });
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createFuelLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.fuelLogsService.create(dto);
  }
}
