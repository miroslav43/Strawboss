import { Controller, Get, Post, Patch, Body, Param, ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createOrganizationSchema, updateOrgRequestSettingsSchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import type { CreateOrganizationDto, OrgRequestSettings } from '@strawboss/types';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @Roles(UserRole.super_admin)
  list() {
    return this.organizationsService.list();
  }

  @Get(':id')
  @Roles(UserRole.super_admin)
  findById(@Param('id') id: string) {
    return this.organizationsService.findById(id);
  }

  @Post()
  @Roles(UserRole.super_admin)
  create(@Body(new ZodValidationPipe(createOrganizationSchema)) dto: CreateOrganizationDto) {
    return this.organizationsService.create(dto);
  }

  /** Admin reads its own org's request-portal settings (code + allowed crops). */
  @Get('me/request-settings')
  @Roles(UserRole.admin)
  getRequestSettings(@CurrentUser() user: RequestUser) {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return this.organizationsService.getRequestSettings(user.organizationId);
  }

  @Patch('me/request-settings')
  @Roles(UserRole.admin)
  updateRequestSettings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateOrgRequestSettingsSchema)) dto: OrgRequestSettings,
  ) {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return this.organizationsService.updateRequestSettings(user.organizationId, dto);
  }
}
