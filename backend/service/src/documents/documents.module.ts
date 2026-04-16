import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { CmrController } from './cmr/cmr.controller';
import { CmrService } from './cmr/cmr.service';
import { CmrProcessor } from './cmr/cmr.processor';

@Module({
  controllers: [DocumentsController, CmrController],
  providers: [DocumentsService, CmrService, CmrProcessor],
  exports: [DocumentsService, CmrService],
})
export class DocumentsModule {}
