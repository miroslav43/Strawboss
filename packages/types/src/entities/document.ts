import type { Timestamps, SoftDelete } from "../common.js";

export enum DocumentType {
  cmr = "cmr",
  invoice = "invoice",
  delivery_note = "delivery_note",
  weight_ticket = "weight_ticket",
  report = "report",
}

export enum DocumentStatus {
  pending = "pending",
  generating = "generating",
  generated = "generated",
  sent = "sent",
  failed = "failed",
}

export interface Document extends Timestamps, SoftDelete {
  id: string;
  tripId: string;
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
