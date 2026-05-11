import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { User } from '@strawboss/types';

@Injectable()
export class ProfileService {
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
        u.last_login_at AS "lastLoginAt",
        u.assigned_machine_id AS "assignedMachineId",
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

  async updateProfile(
    userId: string,
    dto: {
      fullName?: string;
      phone?: string | null;
      locale?: 'en' | 'ro';
      notificationPrefs?: Record<string, boolean>;
      avatarUrl?: string | null;
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
    const anonKey = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    if (anonKey && supabaseUrl) {
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
    }

    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to change password',
      );
    }
  }
}
