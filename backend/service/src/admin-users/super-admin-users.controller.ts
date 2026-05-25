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
} from '@nestjs/common';
import { AdminUsersService, CreateUserDto, UpdateUserDto } from './admin-users.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '@strawboss/types';
import { createUserSchema, updateUserSchema } from '@strawboss/validation';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

/**
 * Super-admin endpoints for managing users inside any organization.
 *
 * Scoped on `:orgId` from the URL — super_admin acts on the org explicitly
 * named in the path. Delegates to the same `AdminUsersService` as the
 * org-scoped `/admin/users` controller, but passes the orgId from the URL
 * instead of the caller's session orgId (which is null for super_admin).
 *
 * Pre-validates that the organization exists so unknown ids return 404
 * before any user table reads/writes happen.
 */
@Controller('super-admin/organizations/:orgId/users')
@Roles(UserRole.super_admin)
export class SuperAdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /** GET /api/v1/super-admin/organizations/:orgId/users */
  @Get()
  async list(@Param('orgId') orgId: string) {
    await this.organizationsService.findById(orgId);
    return this.adminUsersService.listUsers(orgId);
  }

  /** POST /api/v1/super-admin/organizations/:orgId/users */
  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ) {
    await this.organizationsService.findById(orgId);
    return this.adminUsersService.createUser(orgId, dto);
  }

  /** PATCH /api/v1/super-admin/organizations/:orgId/users/:userId */
  @Patch(':userId')
  async update(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    await this.organizationsService.findById(orgId);
    return this.adminUsersService.updateUser(userId, orgId, dto);
  }

  /** DELETE /api/v1/super-admin/organizations/:orgId/users/:userId */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('orgId') orgId: string, @Param('userId') userId: string): Promise<void> {
    await this.organizationsService.findById(orgId);
    await this.adminUsersService.deactivateUser(userId, orgId);
  }
}
