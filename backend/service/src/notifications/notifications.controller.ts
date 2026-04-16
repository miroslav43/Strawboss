import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { UserRole } from '@strawboss/types';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @CurrentUser() user: RequestUser,
    @Body() body: { token: string; platform: string; machineId?: string },
  ) {
    await this.notificationsService.registerToken(
      user.id,
      body.machineId ?? null,
      body.token,
      body.platform,
    );
    return { ok: true };
  }

  @Post('confirm-parcel-done')
  @Roles('admin' as UserRole, 'baler_operator' as UserRole)
  async confirmParcelDone(
    @CurrentUser() user: RequestUser,
    @Body() body: { assignmentId: string; baleCount?: number },
  ) {
    if (!body.assignmentId) {
      throw new BadRequestException('assignmentId is required');
    }
    if (body.baleCount != null && (body.baleCount < 0 || body.baleCount > 9999)) {
      throw new BadRequestException('baleCount must be between 0 and 9999');
    }

    await this.notificationsService.confirmParcelDone(
      body.assignmentId,
      body.baleCount,
      user.id,
    );
    return { ok: true };
  }
}
