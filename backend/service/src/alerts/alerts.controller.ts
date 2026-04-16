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

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  @Roles('admin' as UserRole)
  create(@Body() dto: Record<string, unknown>) {
    return this.alertsService.create(dto);
  }

  @Get()
  list(
    @Query('category') category?: string,
    @Query('severity') severity?: string,
    @Query('isAcknowledged') isAcknowledged?: string,
  ) {
    return this.alertsService.list({ category, severity, isAcknowledged });
  }

  @Get('unacknowledged')
  listUnacknowledged() {
    return this.alertsService.listUnacknowledged();
  }

  @Patch(':id/acknowledge')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.alertsService.acknowledge(id, user.id);
  }
}
