import { Controller, Get, Param, Query, Res, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';
import { isUploadUrl, signUploadUrl } from '../uploads/uploads-signing';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('tripId') tripId?: string,
    @Query('documentType') documentType?: string,
  ) {
    return this.documentsService.list(user.organizationId, { tripId, documentType });
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.documentsService.findById(id, user.organizationId);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: FastifyReply,
  ) {
    const doc = await this.documentsService.findById(id, user.organizationId);
    const fileUrl = doc.fileUrl as string | null;

    if (!fileUrl) {
      throw new NotFoundException('Document file not available');
    }

    // Redirect to the file URL. The global UploadUrlSigningInterceptor never
    // runs here (this handler writes the response directly via @Res()), so
    // /api/v1/uploads/... targets (e.g. an aviz delivery_note) must be signed
    // explicitly or the unauthenticated static route will 401 on the redirect.
    const target = isUploadUrl(fileUrl)
      ? signUploadUrl(fileUrl, this.config.getOrThrow<string>('SUPABASE_JWT_SECRET'), Date.now())
      : fileUrl;
    res.redirect(target);
  }
}
