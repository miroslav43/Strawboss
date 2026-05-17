import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createAlertSchema } from '@strawboss/validation';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  @Roles('admin' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createAlertSchema)) dto: { category: string; severity?: string; title: string; description: string; machineId?: string | null },
  ) {
    return this.alertsService.create(user.organizationId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('category') category?: string,
    @Query('severity') severity?: string,
    @Query('isAcknowledged') isAcknowledged?: string,
  ) {
    return this.alertsService.list(user.organizationId, { category, severity, isAcknowledged });
  }

  @Get('unacknowledged')
  listUnacknowledged(@CurrentUser() user: RequestUser) {
    return this.alertsService.listUnacknowledged(user.organizationId);
  }

  @Patch(':id/acknowledge')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.alertsService.acknowledge(id, user.id, user.organizationId);
  }
}
