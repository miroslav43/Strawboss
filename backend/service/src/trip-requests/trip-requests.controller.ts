import { Controller, Get, Post, Body, Param, Query, ForbiddenException } from '@nestjs/common';
import { TripRequestsService } from './trip-requests.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { confirmTripRequestSchema, cancelTripRequestSchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';

@Controller('trip-requests')
export class TripRequestsController {
  constructor(private readonly service: TripRequestsService) {}

  /**
   * Fail CLOSED on a missing org claim. A null organizationId would otherwise
   * skip the org filter in the service and expose every tenant's requests.
   * (admin/dispatcher always carry an org; this is defense-in-depth.)
   */
  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  @Get()
  @Roles(UserRole.admin, UserRole.dispatcher)
  list(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.service.list(this.requireOrg(user), status);
  }

  @Get(':id')
  @Roles(UserRole.admin, UserRole.dispatcher)
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.findById(this.requireOrg(user), id);
  }

  @Post(':id/confirm')
  @Roles(UserRole.admin, UserRole.dispatcher)
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmTripRequestSchema)) dto: { internalCode?: string },
  ) {
    return this.service.confirm(this.requireOrg(user), id, user.id, dto.internalCode);
  }

  @Post(':id/cancel')
  @Roles(UserRole.admin, UserRole.dispatcher)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelTripRequestSchema)) dto: { reason?: string },
  ) {
    return this.service.cancel(this.requireOrg(user), id, dto.reason);
  }
}
