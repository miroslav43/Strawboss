import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { User } from '@strawboss/types';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly configService: ConfigService,
  ) {
    this.supabase = createClient(
      configService.get<string>('SUPABASE_URL')!,
      configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }

  async findByUserId(userId: string): Promise<User> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        u.id, u.email, u.phone, u.full_name AS "fullName",
        u.role, u.is_active AS "isActive", u.locale,
        u.avatar_url AS "avatarUrl",
        u.signature_specimen_url AS "signatureSpecimenUrl",
        u.last_login_at AS "lastLoginAt",
        u.last_seen_at AS "lastSeenAt",
        u.assigned_machine_id AS "assignedMachineId",
        u.assigned_delivery_destination_id AS "assignedDeliveryDestinationId",
        u.notification_prefs AS "notificationPrefs",
        u.organization_id AS "organizationId",
        o.slug AS "organizationSlug",
        u.created_at AS "createdAt", u.updated_at AS "updatedAt",
        u.deleted_at AS "deletedAt"
      FROM users u
      LEFT JOIN organizations o
        ON o.id = u.organization_id AND o.deleted_at IS NULL
      WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL
      LIMIT 1
    `);
    const rows = result as unknown as User[];
    if (!rows.length) {
      throw new NotFoundException('User profile not found');
    }
    return rows[0];
  }

  /**
   * Plan C — bump `users.last_seen_at` to NOW() and roll the user's session
   * history in `user_sessions`. Called by POST /profile/heartbeat (mobile, ~30 s).
   *
   * The two writes are intentionally NOT atomic. The `last_seen_at` bump powers
   * the admin "online now" presence dot and is the critical path — it must
   * succeed even if the secondary session-history roll fails. (Coupling them in
   * one statement once let a missing `user_sessions_user_started_unique`
   * constraint make every heartbeat 500 and roll the bump back too, freezing
   * presence org-wide. Keeping them independent prevents that recurring.)
   *
   * Session semantics (Plan A T4 — connected-hours report):
   *   - gap to last `ended_at` ≤ 2 min → extend the current session (UPDATE).
   *   - gap > 2 min                    → open a new session (INSERT).
   *
   * Restricted to mobile-app roles (operators). Admin/super_admin sessions from
   * the browser are intentionally not tracked.
   */
  async touchLastSeen(userId: string): Promise<void> {
    // Critical path: presence "online now" dot. Never gate this on the
    // secondary session-history write below.
    await this.drizzleProvider.db.execute(sql`
      UPDATE users SET last_seen_at = NOW()
       WHERE id = ${userId}::uuid AND deleted_at IS NULL
    `);

    // Best-effort: roll the user's connected-session history for the
    // "connected hours" report. Any failure here is logged and swallowed so a
    // heartbeat never 500s — presence has already been updated above.
    try {
      await this.drizzleProvider.db.execute(sql`
        WITH me AS (
          SELECT id, organization_id, role
            FROM users
           WHERE id = ${userId}::uuid AND deleted_at IS NULL
        ),
        latest AS (
          SELECT id, ended_at
            FROM user_sessions
           WHERE user_id = ${userId}::uuid
           ORDER BY started_at DESC
           LIMIT 1
        ),
        extend AS (
          UPDATE user_sessions us
             SET ended_at = NOW()
            FROM latest, me
           WHERE us.id = latest.id
             AND me.organization_id IS NOT NULL
             AND me.role IN ('baler_operator', 'loader_operator', 'driver', 'geofence_maker', 'depot_manager')
             AND NOW() - latest.ended_at <= INTERVAL '2 minutes'
          RETURNING us.id
        )
        INSERT INTO user_sessions (user_id, organization_id, started_at, ended_at)
        SELECT me.id, me.organization_id, NOW(), NOW()
          FROM me
         WHERE me.organization_id IS NOT NULL
           AND me.role IN ('baler_operator', 'loader_operator', 'driver', 'geofence_maker', 'depot_manager')
           AND NOT EXISTS (SELECT 1 FROM extend)
        ON CONFLICT (user_id, started_at) DO NOTHING
      `);
    } catch (err) {
      this.logger.warn(
        `user_sessions roll failed for ${userId} (presence still updated): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Bind a device to the operator currently logged into it — the secure source
   * for the super-admin fleet "connected user" display. Called from the
   * AUTHENTICATED heartbeat, so `userId` is the guard-verified JWT subject and
   * therefore unspoofable (unlike a value sent on the public check-in). The
   * device is identified by its own SecureStore UUID; a caller can only ever bind
   * a device to *their own* verified id, so the worst case is cosmetic.
   */
  async bindDeviceToUser(deviceUuid: string, userId: string): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      UPDATE devices
         SET last_user_id = ${userId}::uuid, updated_at = NOW()
       WHERE device_uuid = ${deviceUuid} AND deleted_at IS NULL
    `);
  }

  async updateProfile(
    userId: string,
    dto: {
      fullName?: string;
      phone?: string | null;
      locale?: 'en' | 'ro';
      notificationPrefs?: Record<string, boolean>;
      avatarUrl?: string | null;
      signatureSpecimenUrl?: string | null;
    },
  ): Promise<User> {
    await this.findByUserId(userId);

    const sets: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (dto.fullName !== undefined) {
      sets.push(sql`full_name = ${dto.fullName}`);
    }
    if (dto.phone !== undefined) {
      sets.push(sql`phone = ${dto.phone}`);
    }
    if (dto.locale !== undefined) {
      sets.push(sql`locale = ${dto.locale}`);
    }
    if (dto.notificationPrefs !== undefined) {
      sets.push(sql`notification_prefs = ${JSON.stringify(dto.notificationPrefs)}::jsonb`);
    }
    if (dto.avatarUrl !== undefined) {
      sets.push(sql`avatar_url = ${dto.avatarUrl}`);
    }
    if (dto.signatureSpecimenUrl !== undefined) {
      sets.push(sql`signature_specimen_url = ${dto.signatureSpecimenUrl}`);
    }

    const setClause = sql.join(sets, sql`, `);
    await this.drizzleProvider.db.execute(sql`
      UPDATE users SET ${setClause}
      WHERE id = ${userId}::uuid AND deleted_at IS NULL
    `);

    return this.findByUserId(userId);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters');
    }

    // Fetch the user to get their email for re-authentication
    const user = await this.findByUserId(userId);

    // Verify current password by attempting sign-in with the user client
    const anonKey = this.configService.getOrThrow<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      throw new BadRequestException('Current password is incorrect');
    }
    // Invalidate the verification session immediately — we don't need it
    await userClient.auth.signOut();

    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      throw new BadRequestException(error.message || 'Failed to change password');
    }
  }
}
