import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { CmrController } from './cmr/cmr.controller';
import { CmrService } from './cmr/cmr.service';

@Module({
  controllers: [DocumentsController, CmrController],
  providers: [DocumentsService, CmrService],
  exports: [DocumentsService, CmrService],
})
export class DocumentsModule {}
