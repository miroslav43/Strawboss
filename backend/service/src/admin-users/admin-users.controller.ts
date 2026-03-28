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
import { Roles } from '../auth/roles.guard';
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
