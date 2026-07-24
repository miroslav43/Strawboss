import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { CmrController } from './cmr/cmr.controller';
import { CmrService } from './cmr/cmr.service';
import { CmrProcessor } from './cmr/cmr.processor';
import { ComandaService } from './comanda/comanda.service';
import { ComandaProcessor } from './comanda/comanda.processor';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [DocumentsController, CmrController],
  providers: [DocumentsService, CmrService, CmrProcessor, ComandaService, ComandaProcessor],
  exports: [DocumentsService, CmrService, ComandaService],
})
export class DocumentsModule {}
