import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Dev-only utilities (mock event simulator, etc.). Registered conditionally
 * in `AppModule` based on NODE_ENV / STRAWBOSS_ENABLE_DEV — never reachable
 * in production unless explicitly enabled.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
