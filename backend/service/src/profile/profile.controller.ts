import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { User } from '@strawboss/types';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * GET /api/v1/profile
   * Returns the public.users row for the currently authenticated user.
   */
  @Get()
  async getProfile(@CurrentUser() currentUser: RequestUser): Promise<User> {
    return this.profileService.findByUserId(currentUser.id);
  }

  /**
   * PATCH /api/v1/profile
   * Update profile fields: fullName, phone, locale, notificationPrefs.
   */
  @Patch()
  async patchProfile(
    @CurrentUser() currentUser: RequestUser,
    @Body()
    dto: {
      fullName?: string;
      phone?: string | null;
      locale?: 'en' | 'ro';
      notificationPrefs?: Record<string, boolean>;
    },
  ): Promise<User> {
    return this.profileService.updateProfile(currentUser.id, dto);
  }

  /**
   * POST /api/v1/profile/change-password
   * Change the current user's password.
   */
  @Post('change-password')
  async changePassword(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: { currentPassword: string; newPassword: string },
  ) {
    await this.profileService.changePassword(
      currentUser.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { ok: true };
  }
}
