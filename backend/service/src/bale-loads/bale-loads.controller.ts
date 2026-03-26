import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { BaleLoadsService } from './bale-loads.service';
import { Roles } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBaleLoadSchema } from '@strawboss/validation';
import type { UserRole } from '@strawboss/types';

@Controller('bale-loads')
export class BaleLoadsController {
  constructor(private readonly baleLoadsService: BaleLoadsService) {}

  @Get()
  list(
    @Query('tripId') tripId?: string,
    @Query('parcelId') parcelId?: string,
  ) {
    return this.baleLoadsService.list({ tripId, parcelId });
  }

  @Post()
  @Roles('loader_operator' as UserRole, 'admin' as UserRole)
  create(
    @Body(new ZodValidationPipe(createBaleLoadSchema))
    dto: Record<string, unknown>,
  ) {
    return this.baleLoadsService.create(dto);
  }
}
