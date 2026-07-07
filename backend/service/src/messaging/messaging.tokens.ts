import type { MessageKind } from '@strawboss/types';

/** DI token for the (unwired) outbound messaging service. */
export const MESSAGING_SERVICE = Symbol('MESSAGING_SERVICE');

/** A file attached to an outbound email (Resend format: base64 content). */
export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file bytes. */
  content: string;
  /** Optional MIME type (e.g. 'application/pdf'); Resend infers from filename if absent. */
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  /** Optional rich HTML body; falls back to `body` (plain text) when absent. */
  html?: string;
  /** Optional file attachments (e.g. the aviz PDF). Not persisted to the outbox. */
  attachments?: EmailAttachment[];
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
