import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@strawboss/types';
import { Roles } from '../auth/roles.guard';
import { UploadsService } from './uploads.service';

/**
 * All roles that can appear on a trip and may need to upload a signature:
 * drivers sign departure/completion, loader operators sign load confirmation.
 */
const SIGNATURE_ROLES = [
  UserRole.admin,
  UserRole.dispatcher,
  UserRole.driver,
  UserRole.loader_operator,
  UserRole.baler_operator,
] as const;

/**
 * Receipt uploads (fuel / consumable) for the mobile app.
 *
 * Mobile captures a photo, compresses it client-side (WebP), and POSTs the
 * result here as `multipart/form-data`. The file is written to disk under
 * `UPLOADS_ROOT/receipts/` and served back to admin clients via
 * `@fastify/static` at `/api/v1/uploads/receipts/...`.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('receipt')
  @Roles(
    UserRole.admin,
    UserRole.dispatcher,
    UserRole.baler_operator,
    UserRole.loader_operator,
    UserRole.driver,
  )
  async uploadReceipt(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }

    const kindField = file.fields?.['kind'];
    const kind =
      kindField && !Array.isArray(kindField) && 'value' in kindField
        ? (kindField.value as string | undefined)
        : undefined;

    return this.uploadsService.saveReceipt({
      mimetype: file.mimetype,
      filename: file.filename,
      stream: file.file,
      kind,
    });
  }

  /**
   * Binary signature upload — alternative to embedding raw base64 in trip
   * transition JSON bodies (which can exceed proxy/nginx body size limits).
   *
   * Mobile flow:
   *   1. POST multipart/form-data with field `file` (PNG from canvas) here.
   *   2. Receive `{ url: "/api/v1/uploads/signatures/<uuid>.png", ... }`.
   *   3. Pass `url` as `driverSignature` / `receiverSignature` in the trip
   *      transition body — the service stores it as-is in `*_signature_url`.
   *
   * Old base64 clients remain fully compatible: the trip service already
   * accepts any non-empty string for those fields and stores it verbatim.
   *
   * Stored at: `UPLOADS_ROOT/signatures/<uuid>.<ext>`
   * Served at:  `GET /api/v1/uploads/signatures/<uuid>.<ext>` (via @fastify/static)
   */
  @Post('signature')
  @Roles(...SIGNATURE_ROLES)
  async uploadSignature(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException('Missing "file" part');
    }

    return this.uploadsService.saveSignature({
      mimetype: file.mimetype,
      stream: file.file,
    });
  }
}
