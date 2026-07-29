import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { UserRole } from '@strawboss/types';
import { cmrScanKindSchema, type CmrScanKind } from '@strawboss/validation';
import { CmrScansService } from './cmr-scans.service';
import { Roles, CurrentUser, type RequestUser } from '../auth';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
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

  /**
   * Read a text field the client streamed BEFORE the `file` part.
   *
   * @fastify/multipart only surfaces a field on `file.fields` once it has been
   * parsed off the wire, and `req.file()` stops reading at the file — so any
   * field that comes AFTER the file is invisible here. Both callers therefore
   * MUST append pageCount/scanId ahead of the file part (mobile does; admin-web
   * sends neither). A field sent out of order silently reads as null.
   */
  private textField(file: MultipartFile, name: string): string | null {
    const field = file.fields?.[name];
    if (!field || Array.isArray(field) || !('value' in field)) return null;
    const value = (field as { value: unknown }).value;
    return typeof value === 'string' ? value : null;
  }

  private pageCount(file: MultipartFile): number | null {
    const raw = this.textField(file, 'pageCount');
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /**
   * Stable per-scan UUID the device mints before its first upload attempt, so a
   * retry overwrites the same storage blob (see SaveCmrScanInput.scanId).
   * Passed through raw — UploadsService validates the UUID shape and falls back
   * to a random filename otherwise, so a bad value can never traverse the path.
   */
  private scanId(file: MultipartFile): string | null {
    return this.textField(file, 'scanId');
  }

  /**
   * Mobile: the loader uploads the PDF built from the document-scanner shots.
   * `?kind=` defaults to `loading` so the mobile app (which never sends it)
   * keeps hitting the departure CMR unchanged.
   */
  @Post('trip/:tripId')
  @Roles(UserRole.admin, UserRole.loader_operator)
  async uploadForTrip(
    @CurrentUser() user: RequestUser,
    @Param('tripId') tripId: string,
    @Query('kind', new ZodValidationPipe(cmrScanKindSchema)) kind: CmrScanKind,
    @Req() req: FastifyRequest,
  ) {
    const file = await this.requireFile(req);
    return this.service.uploadForTrip(
      this.requireOrg(user),
      tripId,
      {
        mimetype: file.mimetype,
        stream: file.file,
        pageCount: this.pageCount(file),
        scanId: this.scanId(file),
        source: 'loader_scan',
      },
      kind,
    );
  }

  /**
   * Admin/dispatcher override: upload (or replace) a CMR straight from the
   * requests page — either end, depending on `?kind=`.
   */
  @Post('trip-request/:requestId')
  @Roles(UserRole.admin, UserRole.dispatcher)
  async uploadForRequest(
    @CurrentUser() user: RequestUser,
    @Param('requestId') requestId: string,
    @Query('kind', new ZodValidationPipe(cmrScanKindSchema)) kind: CmrScanKind,
    @Req() req: FastifyRequest,
  ) {
    const file = await this.requireFile(req);
    return this.service.uploadForRequest(
      this.requireOrg(user),
      requestId,
      {
        mimetype: file.mimetype,
        stream: file.file,
        pageCount: this.pageCount(file),
        scanId: this.scanId(file),
        source: 'admin_upload',
      },
      kind,
    );
  }

  @Get('trip-request/:requestId')
  @Roles(UserRole.admin, UserRole.dispatcher)
  listForRequest(
    @CurrentUser() user: RequestUser,
    @Param('requestId') requestId: string,
    @Query('kind', new ZodValidationPipe(cmrScanKindSchema)) kind: CmrScanKind,
  ) {
    return this.service.listForRequest(this.requireOrg(user), requestId, kind);
  }
}
