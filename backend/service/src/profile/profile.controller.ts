import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import type { RequestUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { updateProfileLocaleSchema } from '@strawboss/validation';
import type { User } from '@strawboss/types';
import { ProfileService } from './profile.service';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * GET /api/v1/profile
   * Returns the public.users row for the currently authenticated user,
   * including assignedMachineId. Available to any role.
   */
  @Get()
  async getProfile(@CurrentUser() currentUser: RequestUser): Promise<User> {
    return this.profileService.findByUserId(currentUser.id);
  }

  /**
   * PATCH /api/v1/profile
   * Update allowed profile fields for the current user only (e.g. UI locale).
   */
  @Patch()
  async patchProfile(
    @CurrentUser() currentUser: RequestUser,
    @Body(new ZodValidationPipe(updateProfileLocaleSchema)) dto: { locale: 'en' | 'ro' },
  ): Promise<User> {
    return this.profileService.updateLocale(currentUser.id, dto.locale);
  }
}
