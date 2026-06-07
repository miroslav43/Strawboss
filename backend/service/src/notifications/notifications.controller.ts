import { Controller, Post, Body, BadRequestException, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service';
import { TripsService } from '../trips/trips.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/auth.guard';
import type { UserRole } from '@strawboss/types';
import {
  adminSimulatePushSchema,
  broadcastNotificationSchema,
  loaderRecallResponseSchema,
} from '@strawboss/validation';

const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  machineId: z.string().uuid().optional(),
});

const unregisterTokenSchema = z.object({
  token: z.string().min(1),
});

const confirmParcelDoneSchema = z.object({
  assignmentId: z.string().uuid(),
  baleCount: z.number().int().min(0).max(9999).optional(),
  finishState: z.enum(['partial', 'total']).optional(),
});

const confirmParcelEntrySchema = z.object({
  assignmentId: z.string().uuid(),
});

const confirmParcelLoadedSchema = z.object({
  assignmentId: z.string().uuid(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly tripsService: TripsService,
  ) {}

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
   * Deactivate this device's push token for the current user on logout, so the
   * next operator who logs in on the same phone does not keep receiving the
   * previous user's notifications. Best-effort — must be called BEFORE the
   * mobile client signs out, while the JWT is still valid.
   */
  @Post('unregister-token')
  async unregisterToken(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(unregisterTokenSchema))
    body: { token: string },
  ) {
    await this.notificationsService.unregisterToken(user.id, body.token);
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
  @Roles(
    'admin' as UserRole,
    'baler_operator' as UserRole,
    'loader_operator' as UserRole,
    'driver' as UserRole,
  )
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

  /**
   * Loader's answer to the field-exit popup ("Da, am terminat de încărcat").
   * Closes the loader assignment, reconciles produced vs loaded bales, and
   * either completes the parcel or blocks it at `loaded` + raises an alert.
   * Returns the reconciliation so the mobile UI can show the shortage.
   */
  @Post('confirm-parcel-loaded')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  async confirmParcelLoaded(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmParcelLoadedSchema))
    body: { assignmentId: string },
  ) {
    return this.notificationsService.confirmParcelLoaded(
      body.assignmentId,
      user.id,
      user.organizationId,
    );
  }

  /**
   * Plan C — loader's answer to the "Camion descărcat" prompt.
   * - recall=true  → create the next iteration trip (push to driver).
   * - recall=false → record a structured 'declined' decision (migration 00048)
   *                  and immediately alert admins if the truck is now idle.
   */
  @Post('loader-recall-response')
  @Roles('admin' as UserRole, 'loader_operator' as UserRole)
  async loaderRecallResponse(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(loaderRecallResponseSchema))
    body: { tripId: string; recall: boolean },
  ) {
    // P2 — a loader_operator may only answer for the trip they are assigned to.
    // Admins / super_admins may answer on anyone's behalf.
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      const trip = await this.tripsService.findById(body.tripId, user.organizationId);
      if (trip.loader_operator_id !== user.id) {
        throw new ForbiddenException('Nu ești loaderul atribuit acestei curse.');
      }
    }
    if (body.recall) {
      await this.tripsService.createNextIteration(body.tripId, user.organizationId, true, {
        idempotent: true,
      });
    } else {
      await this.tripsService.recordNoRecall(body.tripId, user.organizationId, user.id);
    }
    return { ok: true };
  }
}
