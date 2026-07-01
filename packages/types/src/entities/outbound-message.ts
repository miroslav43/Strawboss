import type { MessageChannel, MessageKind } from '../messaging.js';

export type OutboundMessageStatus = 'pending' | 'sent' | 'failed' | 'delivered';

/** A persisted outbound email/SMS, shown in the admin messages monitor. */
export interface OutboundMessageRecord {
  id: string;
  organizationId: string | null;
  channel: MessageChannel;
  kind: MessageKind | string;
  toAddress: string;
  subject: string | null;
  /** Truncated body preview (the monitor list doesn't return full bodies). */
  bodyPreview: string;
  status: OutboundMessageStatus;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  tripRequestId: string | null;
  claimedByDevice: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
