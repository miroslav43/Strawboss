import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/auth.guard';
import type { UserRole } from '@strawboss/types';
import { adminSimulatePushSchema, broadcastNotificationSchema } from '@strawboss/validation';

const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  machineId: z.string().uuid().optional(),
});

const confirmParcelDoneSchema = z.object({
  assignmentId: z.string().uuid(),
  baleCount: z.number().int().min(0).max(9999).optional(),
  finishState: z.enum(['partial', 'total']).optional(),
});

const confirmParcelEntrySchema = z.object({
  assignmentId: z.string().uuid(),
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
  async simulatePush(@CurrentUser() user: RequestUser, @Body() body: unknown) {
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
  async broadcast(@CurrentUser() user: RequestUser, @Body() body: unknown) {
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
    @Body(new ZodValidationPipe(confirmParcelDoneSchema))
    body: {
      assignmentId: string;
      baleCount?: number;
      finishState?: 'partial' | 'total';
    },
  ) {
    // T6/T9.10: legacy clients (no finishState) default to 'total' for
    // backward compatibility.
    await this.notificationsService.confirmParcelDone(
      body.assignmentId,
      body.baleCount,
      body.finishState ?? 'total',
      user.id,
      user.organizationId,
    );
    return { ok: true };
  }

  /**
   * T6 enter — 10 s auto-confirm POST from mobile baler app after the
   * entry-confirm overlay times out. Idempotent.
   */
  @Post('confirm-parcel-entry')
  @Roles('admin' as UserRole, 'baler_operator' as UserRole)
  async confirmParcelEntry(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmParcelEntrySchema))
    body: { assignmentId: string },
  ) {
    await this.notificationsService.confirmParcelEntry(
      body.assignmentId,
      user.id,
      user.organizationId,
    );
    return { ok: true };
  }
}
