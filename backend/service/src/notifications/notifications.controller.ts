import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/auth.guard';
import type { UserRole } from '@strawboss/types';
import {
  adminSimulatePushSchema,
  broadcastNotificationSchema,
} from '@strawboss/validation';

const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  machineId: z.string().uuid().optional(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(registerTokenSchema))
    body: { token: string; platform: string; machineId?: string },
  ) {
    await this.notificationsService.registerToken(
      user.id,
      body.machineId ?? null,
      body.token,
      body.platform,
    );
    return { ok: true };
  }

  /**
   * Send a single templated push to a user (e.g. truck_arrived_at_loader for QA on prod APK).
   * Admin only — does not require DevModule.
   */
  @Post('simulate-push')
  @Roles('admin' as UserRole)
  async simulatePush(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const parsed = adminSimulatePushSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid simulate-push payload',
      );
    }
    const { userId, event, vars } = parsed.data;
    await this.notificationsService.sendSimulatedPushToUser(
      userId,
      user.organizationId,
      event,
      vars ?? {},
    );
    return { ok: true };
  }

  @Post('broadcast')
  @Roles('admin' as UserRole)
  async broadcast(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const parsed = broadcastNotificationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid broadcast payload');
    }
    const { target, title, body: msgBody } = parsed.data;
    await this.notificationsService.broadcast(user.organizationId, target, title, msgBody);
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
      user.organizationId,
    );
    return { ok: true };
  }
}
