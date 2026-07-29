import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ImagesToPdfService } from './images-to-pdf.service';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService, ImagesToPdfService],
  exports: [UploadsService],
})
export class UploadsModule {}
