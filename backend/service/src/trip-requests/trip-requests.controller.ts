import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TripRequestsService } from './trip-requests.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { confirmTripRequestSchema, cancelTripRequestSchema } from '@strawboss/validation';
import { UserRole } from '@strawboss/types';
import { AVIZ_MAX_BYTES } from '../uploads/uploads.service';

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
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list(this.requireOrg(user), {
      status,
      search,
      dateFrom,
      dateTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
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
    @Body(new ZodValidationPipe(confirmTripRequestSchema))
    dto: { internalCode?: string; depotId?: string; parcelId?: string },
  ) {
    return this.service.confirm(
      this.requireOrg(user),
      id,
      user.id,
      dto.depotId,
      dto.parcelId,
      dto.internalCode,
    );
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

  /**
   * Upload (or replace) the aviz PDF for a request. multipart/form-data, field
   * `file`. Overrides the global 3 MB multipart cap per-call so scanned avize
   * up to AVIZ_MAX_BYTES are accepted.
   */
  @Post(':id/aviz')
  @Roles(UserRole.admin, UserRole.dispatcher)
  async uploadAviz(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }
    const file = await req.file({ limits: { fileSize: AVIZ_MAX_BYTES } });
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }
    return this.service.uploadAviz(this.requireOrg(user), id, {
      mimetype: file.mimetype,
      filename: file.filename,
      stream: file.file,
    });
  }

  @Get(':id/aviz')
  @Roles(UserRole.admin, UserRole.dispatcher)
  listAvize(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listAvize(this.requireOrg(user), id);
  }
}
