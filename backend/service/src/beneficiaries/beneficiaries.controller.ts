import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { BeneficiariesService } from './beneficiaries.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBeneficiarySchema, updateBeneficiarySchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import type { CreateBeneficiaryDto, UpdateBeneficiaryDto } from '@strawboss/types';

@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly service: BeneficiariesService) {}

  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get()
  @Roles(UserRole.admin, UserRole.dispatcher, UserRole.super_admin)
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(this.requireOrg(user));
  }

  @Post()
  @Roles(UserRole.admin, UserRole.super_admin)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createBeneficiarySchema)) dto: CreateBeneficiaryDto,
  ) {
    return this.service.create(this.requireOrg(user), dto);
  }

  @Patch(':id')
  @Roles(UserRole.admin, UserRole.super_admin)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBeneficiarySchema)) dto: UpdateBeneficiaryDto,
  ) {
    return this.service.update(id, this.requireOrg(user), dto);
  }

  @Delete(':id')
  @Roles(UserRole.admin, UserRole.super_admin)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.softDelete(id, this.requireOrg(user));
  }

  @Post(':id/regen-pin')
  @Roles(UserRole.admin, UserRole.super_admin)
  regenPin(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.regenPin(id, this.requireOrg(user));
  }
}
