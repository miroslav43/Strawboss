import { Module } from '@nestjs/common';
import { AdminUsersController, AuthResolveController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { DatabaseModule } from '../database/database.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [DatabaseModule, UploadsModule],
  controllers: [AdminUsersController, AuthResolveController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
