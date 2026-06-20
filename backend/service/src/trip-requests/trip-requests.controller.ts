import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { TripRequestsService } from './trip-requests.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { confirmTripRequestSchema, cancelTripRequestSchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';

@Controller('trip-requests')
export class TripRequestsController {
  constructor(private readonly service: TripRequestsService) {}

  @Get()
  @Roles(UserRole.admin, UserRole.dispatcher)
  list(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.service.list(user.organizationId, status);
  }

  @Get(':id')
  @Roles(UserRole.admin, UserRole.dispatcher)
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.findById(user.organizationId, id);
  }

  @Post(':id/confirm')
  @Roles(UserRole.admin, UserRole.dispatcher)
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmTripRequestSchema)) dto: { internalCode?: string },
  ) {
    return this.service.confirm(user.organizationId, id, user.id, dto.internalCode);
  }

  @Post(':id/cancel')
  @Roles(UserRole.admin, UserRole.dispatcher)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelTripRequestSchema)) dto: { reason?: string },
  ) {
    return this.service.cancel(user.organizationId, id, dto.reason);
  }
}
