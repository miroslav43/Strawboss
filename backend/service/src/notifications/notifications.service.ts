import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { buildSimulatedPush, type SimulatePushEvent } from './simulate-push-templates';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Register or update a push token for a user/machine pair.
   *
   * A physical device's Expo push token is shared across logins — when a new
   * operator signs in on a phone that a previous user was logged into, Expo
   * returns the SAME token. Without cleanup, the old user's
   * `(user_id, token)` row stays `is_active = true` and every push aimed at
   * the previous user keeps landing on this device (e.g. a loader's prompt
   * reaching the truck driver now holding the phone). So before claiming the
   * token for `userId`, deactivate it for every OTHER user.
   */
  async registerToken(
    userId: string,
    machineId: string | null,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      UPDATE device_push_tokens
      SET is_active = false, updated_at = now()
      WHERE token = ${token}
        AND user_id <> ${userId}::uuid
        AND is_active = true
    `);
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
   * Deactivate a single device token for the calling user (logout). Best-effort
   * from the mobile client; the cross-user cleanup in {@link registerToken}
   * is the real safety net for shared devices.
   */
  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      UPDATE device_push_tokens
      SET is_active = false, updated_at = now()
      WHERE user_id = ${userId}::uuid
        AND token = ${token}
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
      const checkRows = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE id = ${userId}::uuid
          AND deleted_at IS NULL
          AND organization_id = ${orgId}::uuid
      `)) as unknown as { id: string }[];
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
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
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
        const checkRows = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users
          WHERE id = ${target.userId}::uuid
            AND deleted_at IS NULL
            AND organization_id = ${orgId}::uuid
        `)) as unknown as { id: string }[];
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
      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users WHERE ${where}`,
      )) as unknown as { id: string }[];
      userIds = rows.map((r) => r.id);
    } else {
      // kind: 'all' — scope to org's device tokens via user join
      if (orgId !== null) {
        const rows = (await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT dpt.user_id::text AS id
          FROM device_push_tokens dpt
          JOIN users u ON u.id = dpt.user_id AND u.deleted_at IS NULL
          WHERE dpt.is_active = true
            AND u.organization_id = ${orgId}::uuid
        `)) as unknown as { id: string }[];
        userIds = rows.map((r) => r.id);
      } else {
        const rows = (await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT user_id::text AS id FROM device_push_tokens WHERE is_active = true
        `)) as unknown as { id: string }[];
        userIds = rows.map((r) => r.id);
      }
    }

    await Promise.all(
      userIds.map((uid) => this.sendPush(uid, title, body, { type: 'broadcast' }).catch(() => {})),
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
    await this.sendPush(userId, 'Confirmare recoltare', `Este câmpul ${parcelName} gata?`, {
      type: 'geofence_exit_confirm',
      assignmentId,
      parcelName,
    });
  }

  /**
   * Confirm a parcel is done (called from mobile notification response).
   * Sets assignment status = done; parcel harvest_status either to
   * `partial_harvested` or `harvested` depending on `finishState` (T6 exit,
   * T9.10). Optionally records bale production if `baleCount` is provided.
   *
   * The DB trigger `trg_prevent_harvest_status_downgrade` (migration 00042)
   * silently no-ops when a higher rank is already set (e.g. parcel already
   * `in_loading`); we catch its `check_violation` and proceed so the
   * assignment still completes.
   */
  async confirmParcelDone(
    assignmentId: string,
    baleCount?: number,
    finishState: 'partial' | 'total' = 'total',
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
    const rows = ownerCheck as unknown as {
      assigned_user_id: string | null;
      organization_id: string | null;
    }[];
    if (rows.length === 0) {
      throw new ForbiddenException('Assignment not found');
    }
    if (orgId !== null && orgId !== undefined && rows[0].organization_id !== orgId) {
      throw new ForbiddenException('Assignment not found in your organization');
    }
    if (callerUserId && rows[0].assigned_user_id && rows[0].assigned_user_id !== callerUserId) {
      throw new ForbiddenException('You do not own this assignment');
    }

    // T9.10 — partial vs total maps to the new harvest_status values.
    const harvestTarget = finishState === 'partial' ? 'partial_harvested' : 'harvested';

    // Update the assignment status to done (always — partial harvest still
    // ends THIS visit; a new assignment can re-visit the parcel later).
    await this.drizzleProvider.db.execute(sql`
      UPDATE task_assignments
      SET status = 'done'::task_assignment_status,
          actual_end = now(),
          updated_at = now()
      WHERE id = ${assignmentId}::uuid
        AND deleted_at IS NULL
    `);

    // Set the parcel harvest_status; downgrade trigger may block if a later
    // state was already reached. We swallow the check_violation so the
    // assignment side-effect (done) still commits and is observable.
    try {
      await this.drizzleProvider.db.execute(sql`
        UPDATE parcels
        SET harvest_status = ${harvestTarget}::harvest_status,
            updated_at = now()
        WHERE id = (
          SELECT parcel_id FROM task_assignments
          WHERE id = ${assignmentId}::uuid
        )
          AND deleted_at IS NULL
      `);
    } catch (err) {
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode === '23514') {
        this.winston.warn('confirmParcelDone: harvest_status update refused by downgrade trigger', {
          context: 'NotificationsService',
          assignmentId,
          targetStatus: harvestTarget,
        });
      } else {
        throw err;
      }
    }

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
        finishState,
      });
    }
  }

  /**
   * Confirm baler operator entry into a parcel (T6 — 10 s auto-confirm).
   *
   * Idempotent. Sets assignment status -> in_progress (only if still
   * `available`) and parcel harvest_status -> `harvesting` (the DB downgrade
   * trigger silently rejects this update when a higher state already exists).
   *
   * Caller must own the assignment OR be admin (enforced at controller).
   */
  async confirmParcelEntry(
    assignmentId: string,
    callerUserId?: string,
    orgId?: string | null,
  ): Promise<void> {
    const ownerCheck = await this.drizzleProvider.db.execute(sql`
      SELECT assigned_user_id, organization_id FROM task_assignments
      WHERE id = ${assignmentId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);
    const rows = ownerCheck as unknown as {
      assigned_user_id: string | null;
      organization_id: string | null;
    }[];
    if (rows.length === 0) {
      throw new ForbiddenException('Assignment not found');
    }
    if (orgId !== null && orgId !== undefined && rows[0].organization_id !== orgId) {
      throw new ForbiddenException('Assignment not found in your organization');
    }
    if (callerUserId && rows[0].assigned_user_id && rows[0].assigned_user_id !== callerUserId) {
      throw new ForbiddenException('You do not own this assignment');
    }

    // Optimistically flip the assignment to in_progress only if still available.
    await this.drizzleProvider.db.execute(sql`
      UPDATE task_assignments
      SET status = 'in_progress'::task_assignment_status,
          actual_start = COALESCE(actual_start, now()),
          updated_at = now()
      WHERE id = ${assignmentId}::uuid
        AND deleted_at IS NULL
        AND status = 'available'::task_assignment_status
    `);

    // Advance the parcel to harvesting. The downgrade trigger silently
    // blocks this when the parcel is already past harvesting; we treat that
    // as success since the goal (capturing the entry) is reached.
    try {
      await this.drizzleProvider.db.execute(sql`
        UPDATE parcels
        SET harvest_status = 'harvesting'::harvest_status,
            updated_at = now()
        WHERE id = (
          SELECT parcel_id FROM task_assignments
          WHERE id = ${assignmentId}::uuid
        )
          AND deleted_at IS NULL
      `);
    } catch (err) {
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode !== '23514') throw err;
    }

    this.winston.log('flow', 'parcels.harvest.entry_confirmed', {
      context: 'NotificationsService',
      assignmentId,
    });
  }

  /**
   * T6 enter: 10 s auto-confirm popup. Carries the parcel code + crop type so
   * the mobile overlay can render a context-rich countdown.
   */
  async sendBalerFieldEntryConfirm(
    userId: string,
    assignmentId: string,
    parcel: {
      id: string;
      code: string;
      name: string | null;
      cropType: string | null;
    },
  ): Promise<void> {
    const cropLabel = parcel.cropType ?? 'cultură necunoscută';
    await this.sendPush(
      userId,
      'Începi balotarea?',
      `Parcela ${parcel.code} — ${cropLabel}. Confirmare automată în 10 s.`,
      {
        type: 'field_entry_confirm',
        assignmentId,
        parcelId: parcel.id,
        parcelCode: parcel.code,
        parcelName: parcel.name,
        cropType: parcel.cropType,
      },
    );
  }

  /**
   * T6 exit: loud horn + production-entry CTA. The mobile push handler reads
   * `_channelId` to route the notification through the dedicated `baler-exit`
   * Android channel registered in app.json (custom sound, bypass DND).
   */
  async sendBalerFieldExitProduction(
    userId: string,
    assignmentId: string,
    parcel: { id: string; code: string; name: string | null },
  ): Promise<void> {
    await this.sendPush(
      userId,
      'Ai ieșit din parcelă',
      `Introdu numărul de baloți pentru ${parcel.code}.`,
      {
        type: 'field_exit_production',
        assignmentId,
        parcelId: parcel.id,
        parcelCode: parcel.code,
        parcelName: parcel.name,
        // Hint to mobile to use the `baler-exit` notification channel.
        _channelId: 'baler-exit',
      },
    );
  }

  // region: plan-c ========================================================
  // Plan C helpers — appended at end of class to avoid conflict with Plan B
  // (which also adds helpers in its own region). Do not interleave.

  /**
   * After a truck completes its trip, prompt the loader operator to recall
   * the truck for another iteration on the same parcel. The notification
   * carries the (now-completed) tripId so the mobile client can call
   * POST /notifications/loader-recall-response with the loader's answer.
   */
  async sendTruckUnloadedLoaderPrompt(
    loaderId: string,
    tripId: string,
    truckCode: string,
  ): Promise<void> {
    await this.sendPush(
      loaderId,
      'Camion descărcat',
      `Camionul ${truckCode} a descărcat. Îl chemi înapoi?`,
      {
        type: 'loader_recall_prompt',
        tripId,
        truckCode,
        actions: ['recall_yes', 'recall_no'],
      },
    );
  }

  /**
   * Fan out a truck-idle alert push to every admin/dispatcher in the org.
   * Called by the BullMQ truck-idle-check processor.
   */
  async sendTruckIdleAdminAlert(
    orgId: string | null,
    truckId: string,
    truckCode: string,
    lastSeenAt: string,
    idleMinutes: number,
    reason: 'idle_timeout' | 'loader_declined' = 'idle_timeout',
  ): Promise<void> {
    const conditions: ReturnType<typeof sql>[] = [
      sql`role IN ('admin'::user_role, 'dispatcher'::user_role)`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id FROM users WHERE ${where}`,
    )) as unknown as { id: string }[];

    const title = reason === 'loader_declined' ? 'Camion eliberat' : 'Camion inactiv';
    const body =
      reason === 'loader_declined'
        ? `Loaderul a refuzat rechemarea — camionul ${truckCode} e liber.`
        : `Camionul ${truckCode} stă neutilizat de ${idleMinutes} min.`;
    await Promise.all(
      rows.map((r) =>
        this.sendPush(r.id, title, body, {
          type: 'truck_idle',
          truckId,
          truckCode,
          lastSeenAt,
          idleMinutes,
          reason,
        }).catch(() => {}),
      ),
    );
  }
  // endregion: plan-c =====================================================
}
