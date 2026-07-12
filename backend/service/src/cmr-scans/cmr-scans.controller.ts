import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { UserRole } from '@strawboss/types';
import { CmrScansService } from './cmr-scans.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { CMR_SCAN_MAX_BYTES } from '../uploads/uploads.service';

@Controller('cmr-scans')
export class CmrScansController {
  constructor(private readonly service: CmrScansService) {}

  /**
   * Fail CLOSED on a missing org claim — a null organizationId would skip the org
   * filter in the service and let a scan land on another tenant's trip.
   */
  private requireOrg(user: RequestUser): string {
    if (!user.organizationId) throw new ForbiddenException('No organization');
    return user.organizationId;
  }

  /**
   * Pull the `file` part, overriding the *global* 3 MB multipart cap from main.ts
   * — without this override a multi-page scan is rejected at ~3 MB with a
   * confusing 413.
   */
  private async requireFile(req: FastifyRequest): Promise<MultipartFile> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }
    const file = await req.file({ limits: { fileSize: CMR_SCAN_MAX_BYTES } });
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }
    return file;
  }

  /** Only readable if the client appended it BEFORE the file part (busboy is streaming). */
  private pageCount(file: MultipartFile): number | null {
    const field = file.fields?.['pageCount'];
    if (!field || Array.isArray(field) || !('value' in field)) return null;
    const n = Number(field.value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /** Mobile: the loader uploads the PDF built from the document-scanner shots. */
  @Post('trip/:tripId')
  @Roles(UserRole.admin, UserRole.loader_operator)
  async uploadForTrip(
    @CurrentUser() user: RequestUser,
    @Param('tripId') tripId: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await this.requireFile(req);
    return this.service.uploadForTrip(this.requireOrg(user), tripId, {
      mimetype: file.mimetype,
      stream: file.file,
      pageCount: this.pageCount(file),
      source: 'loader_scan',
    });
  }

  /** Admin override: upload (or replace) the CMR straight from the requests page. */
  @Post('trip-request/:requestId')
  @Roles(UserRole.admin, UserRole.dispatcher)
  async uploadForRequest(
    @CurrentUser() user: RequestUser,
    @Param('requestId') requestId: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await this.requireFile(req);
    return this.service.uploadForRequest(this.requireOrg(user), requestId, {
      mimetype: file.mimetype,
      stream: file.file,
      pageCount: this.pageCount(file),
      source: 'admin_upload',
    });
  }

  @Get('trip-request/:requestId')
  @Roles(UserRole.admin, UserRole.dispatcher)
  listForRequest(@CurrentUser() user: RequestUser, @Param('requestId') requestId: string) {
    return this.service.listForRequest(this.requireOrg(user), requestId);
  }
}
