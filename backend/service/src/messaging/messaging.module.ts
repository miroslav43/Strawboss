import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MESSAGING_SERVICE } from './messaging.tokens';
import { ResendMessagingService } from './resend-messaging.service';
import { TransportConfirmationProcessor } from './transport-confirmation.processor';
import { AvizNotificationService } from './aviz-notification.service';
import { QUEUE_MESSAGE_SEND } from '../jobs/queues';

/**
 * Binds the real outbound messaging service (email via Resend, SMS via the
 * outbound_messages outbox). Global so any module can inject MESSAGING_SERVICE
 * without re-importing. Also hosts the transport-confirmation queue + processor.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_MESSAGE_SEND })],
  providers: [
    { provide: MESSAGING_SERVICE, useClass: ResendMessagingService },
    TransportConfirmationProcessor,
    AvizNotificationService,
  ],
  exports: [MESSAGING_SERVICE],
})
export class MessagingModule {}
