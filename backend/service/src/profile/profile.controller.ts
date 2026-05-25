import { Controller, Get, Patch, Post, Body, Req, BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import type { User } from '@strawboss/types';
import { ProfileService } from './profile.service';
import { UploadsService } from '../uploads/uploads.service';

@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly uploadsService: UploadsService,
  ) {}

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
      signatureSpecimenUrl?: string | null;
    },
  ): Promise<User> {
    return this.profileService.updateProfile(currentUser.id, dto);
  }

  /**
   * POST /api/v1/profile/heartbeat
   * Plan C — bumps users.last_seen_at. Mobile pings this every ~30 s.
   * Body is empty; auth is enforced by the global guard.
   */
  @Post('heartbeat')
  async heartbeat(@CurrentUser() currentUser: RequestUser) {
    await this.profileService.touchLastSeen(currentUser.id);
    return { ok: true };
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
    await this.profileService.changePassword(currentUser.id, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  /**
   * POST /api/v1/profile/avatar
   *
   * Upload (or replace) the current user's profile picture. Accepts
   * multipart/form-data with a single `file` part. The server re-encodes to
   * 512×512 WebP, writes `uploads/avatars/{userId}.webp`, updates
   * `users.avatar_url`, and returns the full updated user record so the client
   * can swap its cached profile immediately without a follow-up GET.
   */
  @Post('avatar')
  async uploadOwnAvatar(
    @CurrentUser() currentUser: RequestUser,
    @Req() req: FastifyRequest,
  ): Promise<User> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }

    const saved = await this.uploadsService.saveAvatar({
      userId: currentUser.id,
      mimetype: file.mimetype,
      stream: file.file,
    });

    return this.profileService.updateProfile(currentUser.id, {
      avatarUrl: saved.url,
    });
  }

  /**
   * POST /api/v1/profile/specimen
   *
   * Upload (or replace) the current user's signature specimen. Accepts
   * multipart/form-data with a single `file` part (PNG from the mobile canvas
   * or admin-web canvas). Writes `uploads/specimens/{userId}.png`, updates
   * `users.signature_specimen_url`, and returns the full updated user record.
   *
   * The returned URL becomes the value passed as `driverSignature` /
   * `loaderSignature` on the trip transition endpoints, so trips end up
   * pointing at the user's canonical specimen rather than carrying a fresh
   * canvas drawing per transition.
   */
  @Post('specimen')
  async uploadOwnSpecimen(
    @CurrentUser() currentUser: RequestUser,
    @Req() req: FastifyRequest,
  ): Promise<User> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }

    const saved = await this.uploadsService.saveSpecimen({
      userId: currentUser.id,
      mimetype: file.mimetype,
      stream: file.file,
    });

    return this.profileService.updateProfile(currentUser.id, {
      signatureSpecimenUrl: saved.url,
    });
  }
}
