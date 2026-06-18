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
  // Exported so LocationService can touch presence (last_seen_at) on each GPS
  // report — keeps machine-bound operators "online" while backgrounded.
  exports: [ProfileService],
})
export class ProfileModule {}
