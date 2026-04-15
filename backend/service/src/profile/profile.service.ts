import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { User } from '@strawboss/types';

@Injectable()
export class ProfileService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async findByUserId(userId: string): Promise<User> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        id, email, phone, full_name AS "fullName",
        role, is_active AS "isActive", locale,
        avatar_url AS "avatarUrl",
        last_login_at AS "lastLoginAt",
        assigned_machine_id AS "assignedMachineId",
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

  async updateLocale(userId: string, locale: 'en' | 'ro'): Promise<User> {
    await this.findByUserId(userId);
    await this.drizzleProvider.db.execute(sql`
      UPDATE users
      SET locale = ${locale}, updated_at = NOW()
      WHERE id = ${userId}::uuid AND deleted_at IS NULL
    `);
    return this.findByUserId(userId);
  }
}
