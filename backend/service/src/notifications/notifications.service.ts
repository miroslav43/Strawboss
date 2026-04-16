import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

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
   * Send a push notification via Expo's push API.
   */
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

      if (!response.ok) {
        const body = await response.text();
        this.winston.error('Expo push HTTP error', {
          context: 'NotificationsService',
          userId,
          status: response.status,
          body,
        });
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
  ): Promise<void> {
    // Verify ownership: caller must own the assignment (or be admin — checked at controller)
    // Verify assignment exists and check ownership
    const ownerCheck = await this.drizzleProvider.db.execute(sql`
      SELECT assigned_user_id FROM task_assignments
      WHERE id = ${assignmentId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);
    const rows = ownerCheck as unknown as { assigned_user_id: string | null }[];
    if (rows.length === 0) {
      throw new ForbiddenException('Assignment not found');
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
          (parcel_id, baler_id, operator_id, production_date, bale_count, end_time)
        SELECT
          ta.parcel_id,
          ta.machine_id,
          ta.assigned_user_id,
          CURRENT_DATE,
          ${baleCount},
          now()
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
