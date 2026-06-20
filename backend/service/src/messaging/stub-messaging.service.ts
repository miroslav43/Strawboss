import { Injectable, Inject } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';
import { MessageChannel } from '@strawboss/types';
import type { IMessagingService, SendEmailParams, SendSmsParams } from './messaging.tokens';

/**
 * Default, UNWIRED messaging backend. It does not send anything — it only logs
 * the intended message to the flow log so the auxiliary-truck flow is fully
 * observable in dev/prod without a provider. Swap the binding in
 * MessagingModule to send for real.
 */
@Injectable()
export class StubMessagingService implements IMessagingService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger) {}

  async sendEmail(params: SendEmailParams): Promise<void> {
    this.winston.log('flow', `[messaging:stub] EMAIL ${params.kind} → ${params.to}`, {
      context: 'StubMessagingService',
      channel: MessageChannel.email,
      kind: params.kind,
      to: params.to,
      subject: params.subject,
      body: params.body,
      metadata: params.metadata,
    });
  }

  async sendSms(params: SendSmsParams): Promise<void> {
    this.winston.log('flow', `[messaging:stub] SMS ${params.kind} → ${params.to}`, {
      context: 'StubMessagingService',
      channel: MessageChannel.sms,
      kind: params.kind,
      to: params.to,
      body: params.body,
      metadata: params.metadata,
    });
  }
}
