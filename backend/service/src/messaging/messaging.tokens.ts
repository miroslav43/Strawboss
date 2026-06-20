import type { MessageKind } from '@strawboss/types';

/** DI token for the (unwired) outbound messaging service. */
export const MESSAGING_SERVICE = Symbol('MESSAGING_SERVICE');

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  kind: MessageKind;
  metadata?: Record<string, unknown>;
}

export interface SendSmsParams {
  to: string;
  body: string;
  kind: MessageKind;
  metadata?: Record<string, unknown>;
}

/**
 * Outbound email/SMS contract for the auxiliary-truck flow.
 *
 * Intentionally UNWIRED — the default binding is StubMessagingService, which
 * only logs. A real provider (homemade or third-party) is dropped in later by
 * binding a different implementation to MESSAGING_SERVICE; no call site changes.
 */
export interface IMessagingService {
  sendEmail(params: SendEmailParams): Promise<void>;
  sendSms(params: SendSmsParams): Promise<void>;
}
