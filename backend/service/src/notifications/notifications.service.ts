import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import {
  buildSimulatedPush,
  type SimulatePushEvent,
} from './simulate-push-templates';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Register or update a push token for a user/machine pair.
   */
  async registerToken(
    userId: string,
    machineId: string | null,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      INSERT INTO device_push_tokens (user_id, machine_id, token, platform)
      VALUES (${userId}::uuid, ${machineId}::uuid, ${token}, ${platform})
      ON CONFLICT (user_id, token)
      DO UPDATE SET
        machine_id = EXCLUDED.machine_id,
        platform   = EXCLUDED.platform,
        is_active  = true,
        updated_at = now()
    `);
  }

  /**
   * Send a templated simulated push (same payloads as dev simulator) to one user.
   * Production-safe when called from admin-only routes.
   */
  async sendSimulatedPushToUser(
    userId: string,
    orgId: string | null,
    event: SimulatePushEvent,
    vars: Record<string, string> = {},
  ): Promise<void> {
    if (orgId !== null) {
      const checkRows = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE id = ${userId}::uuid
          AND deleted_at IS NULL
          AND organization_id = ${orgId}::uuid
      `) as unknown as { id: string }[];
      if (checkRows.length === 0) {
        throw new ForbiddenException('Target user not found in your organization');
      }
    }
    const { title, body, data } = buildSimulatedPush(event, vars);
    await this.sendPush(userId, title, body, data);
  }

  /** Send a push notification via Expo's push API. */
  async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    // Fetch active tokens for this user
    const tokensResult = await this.drizzleProvider.db.execute(sql`
      SELECT token FROM device_push_tokens
      WHERE user_id = ${userId}::uuid AND is_active = true
    `);
    const tokens = tokensResult as unknown as { token: string }[];

    if (tokens.length === 0) {
      this.winston.warn('No active push tokens for user', {
        context: 'NotificationsService',
        userId,
      });
      return;
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: data ?? {},
      sound: 'default' as const,
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });

      const raw = await response.text();

      if (!response.ok) {
        this.winston.error('Expo push HTTP error', {
          context: 'NotificationsService',
          userId,
          status: response.status,
          body: raw.slice(0, 2000),
        });
        return;
      }

      try {
        const parsed = JSON.parse(raw) as {
          data?: Array<{ status?: string; message?: string; details?: unknown }>;
        };
        const errors = (parsed.data ?? []).filter((r) => r.status === 'error');
        if (errors.length > 0) {
          this.winston.error('Expo push ticket error(s)', {
            context: 'NotificationsService',
            userId,
            errors: errors.map((e) => ({
              message: e.message,
              details: e.details,
            })),
            hint: 'Upload FCM credentials for this Expo project: https://docs.expo.dev/push-notifications/fcm-credentials/',
          });
        }
      } catch {
        /* non-JSON body — ignore */
      }
    } catch (err) {
      this.winston.error('Expo push request error', {
        context: 'NotificationsService',
        userId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
    }
  }

  /**
   * Broadcast a push notification to all users, users of a specific role, or a single user.
   * Scoped to the caller's organization.
   */
  async broadcast(
    orgId: string | null,
    target: { kind: 'all' } | { kind: 'role'; role: string } | { kind: 'user'; userId: string },
    title: string,
    body: string,
  ): Promise<void> {
    let userIds: string[];

    if (target.kind === 'user') {
      if (orgId !== null) {
        const checkRows = await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users
          WHERE id = ${target.userId}::uuid
            AND deleted_at IS NULL
            AND organization_id = ${orgId}::uuid
        `) as unknown as { id: string }[];
        if (checkRows.length === 0) {
          throw new ForbiddenException('Target user not found in your organization');
        }
      }
      userIds = [target.userId];
    } else if (target.kind === 'role') {
      const conditions: ReturnType<typeof sql>[] = [
        sql`role = ${target.role}`,
        sql`deleted_at IS NULL`,
      ];
      if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
      const where = sql.join(conditions, sql` AND `);
      const rows = await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users WHERE ${where}`,
      ) as unknown as { id: string }[];
      userIds = rows.map(r => r.id);
    } else {
      // kind: 'all' — scope to org's device tokens via user join
      if (orgId !== null) {
        const rows = await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT dpt.user_id::text AS id
          FROM device_push_tokens dpt
          JOIN users u ON u.id = dpt.user_id AND u.deleted_at IS NULL
          WHERE dpt.is_active = true
            AND u.organization_id = ${orgId}::uuid
        `) as unknown as { id: string }[];
        userIds = rows.map(r => r.id);
      } else {
        const rows = await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT user_id::text AS id FROM device_push_tokens WHERE is_active = true
        `) as unknown as { id: string }[];
        userIds = rows.map(r => r.id);
      }
    }

    await Promise.all(
      userIds.map(uid =>
        this.sendPush(uid, title, body, { type: 'broadcast' }).catch(() => {}),
      ),
    );

    this.winston.log('info', `Broadcast sent to ${userIds.length} user(s)`, {
      context: 'NotificationsService',
      targetKind: target.kind,
      userCount: userIds.length,
    });
  }

  /**
   * Send a geofence exit notification asking if the parcel is done.
   */
  async sendGeofenceExitNotification(
    assignmentId: string,
    parcelName: string,
    userId: string,
  ): Promise<void> {
    await this.sendPush(
      userId,
      'Confirmare recoltare',
      `Este câmpul ${parcelName} gata?`,
      {
        type: 'geofence_exit_confirm',
        assignmentId,
        parcelName,
      },
    );
  }

  /**
   * Confirm a parcel is done (called from mobile notification response).
   * Sets assignment status = done, parcel harvest_status = harvested,
   * and optionally records bale production if baleCount is provided.
   */
  async confirmParcelDone(
    assignmentId: string,
    baleCount?: number,
    callerUserId?: string,
    orgId?: string | null,
  ): Promise<void> {
    // Verify ownership: caller must own the assignment (or be admin — checked at controller)
    // Verify assignment exists and check ownership
    const ownerCheck = await this.drizzleProvider.db.execute(sql`
      SELECT assigned_user_id, organization_id FROM task_assignments
      WHERE id = ${assignmentId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);
    const rows = ownerCheck as unknown as { assigned_user_id: string | null; organization_id: string | null }[];
    if (rows.length === 0) {
      throw new ForbiddenException('Assignment not found');
    }
    if (orgId !== null && orgId !== undefined && rows[0].organization_id !== orgId) {
      throw new ForbiddenException('Assignment not found in your organization');
    }
    if (callerUserId && rows[0].assigned_user_id && rows[0].assigned_user_id !== callerUserId) {
      throw new ForbiddenException('You do not own this assignment');
    }

    // Update the assignment status to done
    await this.drizzleProvider.db.execute(sql`
      UPDATE task_assignments
      SET status = 'done'::task_assignment_status,
          actual_end = now(),
          updated_at = now()
      WHERE id = ${assignmentId}::uuid
        AND deleted_at IS NULL
    `);

    // Set the parcel harvest_status to harvested
    await this.drizzleProvider.db.execute(sql`
      UPDATE parcels
      SET harvest_status = 'harvested'::parcel_harvest_status,
          updated_at = now()
      WHERE id = (
        SELECT parcel_id FROM task_assignments
        WHERE id = ${assignmentId}::uuid
      )
        AND deleted_at IS NULL
    `);

    // Record bale production if count was provided
    if (baleCount != null && baleCount > 0) {
      await this.drizzleProvider.db.execute(sql`
        INSERT INTO bale_productions
          (parcel_id, baler_id, operator_id, production_date, bale_count, end_time, organization_id)
        SELECT
          ta.parcel_id,
          ta.machine_id,
          ta.assigned_user_id,
          CURRENT_DATE,
          ${baleCount},
          now(),
          ta.organization_id
        FROM task_assignments ta
        WHERE ta.id = ${assignmentId}::uuid
          AND ta.parcel_id IS NOT NULL
          AND ta.assigned_user_id IS NOT NULL
      `);

      this.winston.log('flow', `Bale production recorded via geofence confirm`, {
        context: 'NotificationsService',
        assignmentId,
        baleCount,
      });
    }
  }
}
