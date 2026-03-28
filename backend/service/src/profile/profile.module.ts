import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ProfileController],
})
export class ProfileModule {}
