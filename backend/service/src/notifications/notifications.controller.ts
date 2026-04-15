import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard, type RequestUser } from '../auth/auth.guard';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @Req() req: { user: RequestUser },
    @Body() body: { token: string; platform: string; machineId?: string },
  ) {
    await this.notificationsService.registerToken(
      req.user.id,
      body.machineId ?? null,
      body.token,
      body.platform,
    );
    return { ok: true };
  }

  @Post('confirm-parcel-done')
  async confirmParcelDone(@Body() body: { assignmentId: string }) {
    await this.notificationsService.confirmParcelDone(body.assignmentId);
    return { ok: true };
  }
}
