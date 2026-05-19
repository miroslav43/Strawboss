import { Module } from '@nestjs/common';
import { AdminUsersController, AuthResolveController } from './admin-users.controller';
import { SuperAdminUsersController } from './super-admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { DatabaseModule } from '../database/database.module';
import { UploadsModule } from '../uploads/uploads.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [DatabaseModule, UploadsModule, OrganizationsModule],
  controllers: [AdminUsersController, AuthResolveController, SuperAdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
