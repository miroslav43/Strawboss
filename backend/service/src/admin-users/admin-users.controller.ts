import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminUsersService, CreateUserDto, UpdateUserDto } from './admin-users.service';
import { Roles } from '../auth/roles.guard';
import { Public } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { UserRole } from '@strawboss/types';
import { createUserSchema, updateUserSchema } from '@strawboss/validation';
import { UploadsService } from '../uploads/uploads.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@Controller('admin/users')
@Roles(UserRole.admin)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly uploadsService: UploadsService,
  ) {}

  /** GET /api/v1/admin/users */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.adminUsersService.listUsers(user.organizationId);
  }

  /** POST /api/v1/admin/users */
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ) {
    if (user.organizationId === null) {
      throw new ForbiddenException('Super admin must use the organizations API to assign an org');
    }
    return this.adminUsersService.createUser(user.organizationId, dto);
  }

  /** PATCH /api/v1/admin/users/:id */
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.adminUsersService.updateUser(id, user.organizationId, dto);
  }

  /** DELETE /api/v1/admin/users/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    await this.adminUsersService.deactivateUser(id, user.organizationId);
  }

  /**
   * POST /api/v1/admin/users/:id/avatar
   *
   * Admin-only override: upload a profile picture on behalf of another user.
   * Mirrors `POST /api/v1/profile/avatar` but writes to the target user instead
   * of the caller.
   */
  @Post(':id/avatar')
  async uploadUserAvatar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }

    // Verify the target user belongs to the caller's org before touching disk
    await this.adminUsersService.getById(id, user.organizationId);

    const saved = await this.uploadsService.saveAvatar({
      userId: id,
      mimetype: file.mimetype,
      stream: file.file,
    });

    return this.adminUsersService.setUserAvatar(id, user.organizationId, saved.url);
  }
}

/**
 * Public endpoint — no auth guard — used by login pages to resolve
 * a username to an email so Supabase signInWithPassword can be called.
 */
@Controller('auth')
export class AuthResolveController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  /**
   * POST /api/v1/auth/resolve
   * Body: { login: string }  — a username or an email
   * Response: { email: string }
   */
  @Post('resolve')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: { login?: string }): Promise<{ email: string }> {
    if (!body.login || typeof body.login !== 'string') {
      throw new BadRequestException('login field is required');
    }
    const email = await this.adminUsersService.resolveLogin(body.login.trim());
    return { email };
  }
}
