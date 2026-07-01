import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { FuelLogsService } from './fuel-logs.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createFuelLogSchema, updateFuelLogSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('fuel-logs')
export class FuelLogsController {
  constructor(private readonly fuelLogsService: FuelLogsService) {}

  @Get('stats')
  getStats(
    @CurrentUser() user: RequestUser,
    @Query('operatorId') operatorId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.fuelLogsService.getStats(user.organizationId, {
      operatorId,
      machineId,
      dateFrom,
      dateTo,
    });
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.fuelLogsService.list(user.organizationId, { machineId, dateFrom, dateTo });
  }

  @Post()
  @Roles(
    'admin' as UserRole,
    'baler_operator' as UserRole,
    'loader_operator' as UserRole,
    'driver' as UserRole,
  )
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createFuelLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.fuelLogsService.create(user.organizationId!, dto);
  }

  // Edit/delete are admin-only web actions (drivers still create via mobile POST).
  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateFuelLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.fuelLogsService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.fuelLogsService.softDelete(id, user.organizationId);
  }
}
