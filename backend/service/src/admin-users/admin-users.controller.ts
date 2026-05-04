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
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminUsersService, CreateUserDto, UpdateUserDto } from './admin-users.service';
import { Roles } from '../auth/roles.guard';
import { Public } from '../auth/auth.guard';
import { UserRole } from '@strawboss/types';
import { UploadsService } from '../uploads/uploads.service';

@Controller('admin/users')
@Roles(UserRole.admin)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly uploadsService: UploadsService,
  ) {}

  /** GET /api/v1/admin/users */
  @Get()
  list() {
    return this.adminUsersService.listUsers();
  }

  /** POST /api/v1/admin/users */
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.adminUsersService.createUser(dto);
  }

  /** PATCH /api/v1/admin/users/:id */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminUsersService.updateUser(id, dto);
  }

  /** DELETE /api/v1/admin/users/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.adminUsersService.deactivateUser(id);
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

    const saved = await this.uploadsService.saveAvatar({
      userId: id,
      mimetype: file.mimetype,
      stream: file.file,
    });

    return this.adminUsersService.setUserAvatar(id, saved.url);
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
