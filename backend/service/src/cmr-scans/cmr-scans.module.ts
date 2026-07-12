import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DocumentsModule } from '../documents/documents.module';
import { CmrScansController } from './cmr-scans.controller';
import { CmrScansService } from './cmr-scans.service';

@Module({
  imports: [AuthModule, UploadsModule, DocumentsModule],
  controllers: [CmrScansController],
  providers: [CmrScansService],
  exports: [CmrScansService],
})
export class CmrScansModule {}
