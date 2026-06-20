import { Global, Module } from '@nestjs/common';
import { MESSAGING_SERVICE } from './messaging.tokens';
import { StubMessagingService } from './stub-messaging.service';

/**
 * Binds the (unwired) messaging service. Global so any module can inject
 * MESSAGING_SERVICE without re-importing. To go live, replace useClass with a
 * real implementation of IMessagingService — no call sites change.
 */
@Global()
@Module({
  providers: [{ provide: MESSAGING_SERVICE, useClass: StubMessagingService }],
  exports: [MESSAGING_SERVICE],
})
export class MessagingModule {}
