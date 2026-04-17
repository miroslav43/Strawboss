import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AdminUsersService, CreateUserDto, UpdateUserDto } from './admin-users.service';
import { Roles } from '../auth/roles.guard';
import { Public } from '../auth/auth.guard';
import { UserRole } from '@strawboss/types';

@Controller('admin/users')
@Roles(UserRole.admin)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

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
