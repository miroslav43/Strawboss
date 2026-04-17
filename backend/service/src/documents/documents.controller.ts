import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(
    @Query('tripId') tripId?: string,
    @Query('documentType') documentType?: string,
  ) {
    return this.documentsService.list({ tripId, documentType });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.documentsService.findById(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: FastifyReply) {
    const doc = await this.documentsService.findById(id);
    const fileUrl = doc.file_url as string | null;

    if (!fileUrl) {
      throw new NotFoundException('Document file not available');
    }

    // Redirect to the file URL (e.g. a signed S3/Supabase storage URL)
    res.redirect(fileUrl);
  }
}
