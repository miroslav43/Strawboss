import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
// Entity modules will be added in Task 9

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
})
export class AppModule {}
