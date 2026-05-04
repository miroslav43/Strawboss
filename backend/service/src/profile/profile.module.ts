import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [DatabaseModule, AuthModule, UploadsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
