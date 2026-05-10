import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { FarmsService } from './farms.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createFarmSchema, updateFarmSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';

@Controller('farms')
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.farmsService.list(user.organizationId);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.farmsService.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createFarmSchema)) dto: Record<string, unknown>,
  ) {
    return this.farmsService.create(user.organizationId ?? '', dto);
  }

  @Patch(':id')
  @Roles('admin' as UserRole, 'geofence_maker' as UserRole)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateFarmSchema)) dto: Record<string, unknown>,
  ) {
    return this.farmsService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('admin' as UserRole)
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.farmsService.softDelete(id, user.organizationId);
  }
}
