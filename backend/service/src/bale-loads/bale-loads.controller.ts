import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { BaleLoadsService } from './bale-loads.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBaleLoadSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';
import type { RequestUser } from '../auth/auth.guard';
import { RequireFeature } from '../features/require-feature.decorator';

@Controller('bale-loads')
export class BaleLoadsController {
  constructor(private readonly baleLoadsService: BaleLoadsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('tripId') tripId?: string,
    @Query('parcelId') parcelId?: string,
    @Query('operatorId') operatorId?: string,
    @Query('dateFrom') dateFrom?: string,
  ) {
    return this.baleLoadsService.list(user.organizationId, { tripId, parcelId, operatorId, dateFrom });
  }

  @Post()
  @RequireFeature('bales.load_register')
  @Roles('loader_operator' as UserRole, 'admin' as UserRole)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createBaleLoadSchema))
    dto: Record<string, unknown>,
  ) {
    return this.baleLoadsService.create(user.organizationId!, dto);
  }
}
