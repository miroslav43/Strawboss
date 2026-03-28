import { Controller, Get, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import type { RequestUser } from '../auth/auth.guard';
import { NotFoundException } from '@nestjs/common';
import type { User } from '@strawboss/types';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * GET /api/v1/profile
   * Returns the public.users row for the currently authenticated user,
   * including assignedMachineId. Available to any role.
   */
  @Get()
  async getProfile(@CurrentUser() currentUser: RequestUser): Promise<User> {
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
      WHERE id = ${currentUser.id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const rows = result as unknown as User[];
    if (!rows.length) {
      throw new NotFoundException('User profile not found');
    }
    return rows[0];
  }
}
