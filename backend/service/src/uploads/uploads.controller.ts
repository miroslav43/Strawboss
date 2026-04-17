import {
  BadRequestException,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@strawboss/types';
import { Roles } from '../auth/roles.guard';
import { UploadsService } from './uploads.service';

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
}
