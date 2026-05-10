import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createOrganizationSchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import type { CreateOrganizationDto } from '@strawboss/types';

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
  create(
    @Body(new ZodValidationPipe(createOrganizationSchema)) dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(dto);
  }
}
