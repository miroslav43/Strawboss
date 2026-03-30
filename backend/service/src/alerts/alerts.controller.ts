import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
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
