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
        id, email, phone, full_name AS "fullName",
        role, is_active AS "isActive", locale,
        avatar_url AS "avatarUrl",
        last_login_at AS "lastLoginAt",
        assigned_machine_id AS "assignedMachineId",
        notification_prefs AS "notificationPrefs",
        created_at AS "createdAt", updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM users
      WHERE id = ${userId}::uuid AND deleted_at IS NULL
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

    const setClause = sql.join(sets, sql`, `);
    await this.drizzleProvider.db.execute(sql`
      UPDATE users SET ${setClause}
      WHERE id = ${userId}::uuid AND deleted_at IS NULL
    `);

    return this.findByUserId(userId);
  }

  async changePassword(
    userId: string,
    _currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters');
    }

    // Use Supabase Auth admin API to update password
    // (Supabase stores credentials in auth.users, not public.users)
    const user = await this.findByUserId(userId);
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
