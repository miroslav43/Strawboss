import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { buildSimulatedPush, isSimulatePushEvent, type SimulatePushEvent } from '../notifications/simulate-push-templates';

export type SimulateEvent = SimulatePushEvent;

export interface SimulateTarget {
  userId?: string;
  role?: string;
  machineId?: string;
}

export interface SimulateInput {
  event: SimulateEvent;
  target: SimulateTarget;
  vars?: Record<string, string>;
}

@Injectable()
export class DevService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notificationsService: NotificationsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Simulate a notification event by calling NotificationsService directly,
   * skipping geofence/trip workflow. Used by mock test scripts.
   */
  async simulate(input: SimulateInput, orgId: string | null): Promise<{ targetedUserIds: string[]; sentCount: number }> {
    if (!isSimulatePushEvent(input.event)) {
      throw new BadRequestException(`Unknown event: ${input.event}`);
    }

    const userIds = await this.resolveTargetUserIds(input.target, orgId);
    if (userIds.length === 0) {
      this.winston.warn('Dev simulate: no target users resolved', {
        context: 'DevService',
        event: input.event,
        target: input.target,
      });
      return { targetedUserIds: [], sentCount: 0 };
    }

    const vars = input.vars ?? {};
    const { title, body, data } = buildSimulatedPush(input.event, vars);

    let sent = 0;
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          await this.notificationsService.sendPush(uid, title, body, data);
          sent += 1;
        } catch (err) {
          this.winston.warn(`Dev simulate sendPush failed for user ${uid}`, {
            context: 'DevService',
            userId: uid,
            err: err instanceof Error ? { message: err.message } : err,
          });
        }
      }),
    );

    this.winston.log(
      'flow',
      `Dev simulate '${input.event}' → ${sent}/${userIds.length} push(es)`,
      {
        context: 'DevService',
        event: input.event,
        target: input.target,
        targetedUsers: userIds.length,
        sentCount: sent,
      },
    );

    return { targetedUserIds: userIds, sentCount: sent };
  }

  private async resolveTargetUserIds(target: SimulateTarget, orgId: string | null): Promise<string[]> {
    if (target.userId) {
      if (orgId !== null) {
        const rows = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users
          WHERE id = ${target.userId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `)) as unknown as { id: string }[];
        if (rows.length === 0) {
          throw new BadRequestException('target user not found in your organization');
        }
      }
      return [target.userId];
    }
    if (target.machineId) {
      const conditions: ReturnType<typeof sql>[] = [
        sql`assigned_machine_id = ${target.machineId}::uuid`,
        sql`deleted_at IS NULL`,
      ];
      if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
      const where = sql.join(conditions, sql` AND `);
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users WHERE ${where}
      `)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    }
    if (target.role) {
      const conditions: ReturnType<typeof sql>[] = [
        sql`role = ${target.role}::user_role`,
        sql`deleted_at IS NULL`,
        sql`is_active = true`,
      ];
      if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
      const where = sql.join(conditions, sql` AND `);
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users WHERE ${where}
      `)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    }
    throw new BadRequestException(
      'target must specify at least one of: userId, role, machineId',
    );
  }
}
