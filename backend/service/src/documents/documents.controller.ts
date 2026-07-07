import { Controller, Get, Param, Query, Res, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { UserRole } from '@strawboss/types';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { RequestUser } from '../auth/auth.guard';

@Roles(UserRole.admin, UserRole.dispatcher)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('tripId') tripId?: string,
    @Query('documentType') documentType?: string,
  ) {
    return this.documentsService.list(user.organizationId, user.role, { tripId, documentType });
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.documentsService.findById(id, user.organizationId, user.role);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: FastifyReply,
  ) {
    const doc = await this.documentsService.findById(id, user.organizationId, user.role);
    const fileUrl = doc.fileUrl as string | null;

    if (!fileUrl) {
      throw new NotFoundException('Document file not available');
    }

    // Redirect to the file URL (e.g. a signed S3/Supabase storage URL)
    res.redirect(fileUrl);
  }
}
