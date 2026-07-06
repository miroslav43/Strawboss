import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ConsumableLogsService } from './consumable-logs.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createConsumableLogSchema, updateConsumableLogSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('consumable-logs')
export class ConsumableLogsController {
  constructor(private readonly consumableLogsService: ConsumableLogsService) {}

  @Get('stats')
  getStats(
    @CurrentUser() user: RequestUser,
    @Query('operatorId') operatorId?: string,
    @Query('consumableType') consumableType?: string,
  ) {
    return this.consumableLogsService.getStats(user.organizationId, { operatorId, consumableType });
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.consumableLogsService.list(user.organizationId, {
      machineId,
      parcelId,
      dateFrom,
      dateTo,
    });
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
    @Body(new ZodValidationPipe(createConsumableLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.consumableLogsService.create(user.organizationId!, dto);
  }

  // Edit/delete are admin-only web actions (operators still create via mobile POST).
  @Patch(':id')
  @Roles('admin' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateConsumableLogSchema))
    dto: Record<string, unknown>,
  ) {
    return this.consumableLogsService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.consumableLogsService.softDelete(id, user.organizationId);
  }
}
