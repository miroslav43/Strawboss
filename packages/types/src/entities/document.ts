import type { Timestamps, SoftDelete } from '../common.js';

export enum DocumentType {
  // `cmr` is the CMR the backend generates itself (Puppeteer, stage 1/2).
  // `cmr_scan` is the physical paper CMR the loader photographs at the end of
  // an auxiliary load — a different artefact, so it gets its own type rather
  // than competing with the generated one for the same slot.
  cmr = 'cmr',
  cmr_scan = 'cmr_scan',
  invoice = 'invoice',
  delivery_note = 'delivery_note',
  weight_ticket = 'weight_ticket',
  report = 'report',
}

export enum DocumentStatus {
  pending = 'pending',
  generating = 'generating',
  partial = 'partial',
  generated = 'generated',
  sent = 'sent',
  failed = 'failed',
}

export interface Document extends Timestamps, SoftDelete {
  id: string;
  // A document is scoped to a trip (generated CMR/weight-ticket) OR to a trip
  // request (an aviz uploaded before the request is confirmed into a trip).
  tripId: string | null;
  tripRequestId: string | null;
  documentType: DocumentType;
  status: DocumentStatus;
  title: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  metadata: Record<string, unknown> | null;
  generatedAt: string | null;
  sentAt: string | null;
  sentTo: string[] | null;
}
