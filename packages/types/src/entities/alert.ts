import type { Timestamps } from "../common.js";

export enum AlertCategory {
  fraud = "fraud",
  anomaly = "anomaly",
  maintenance = "maintenance",
  safety = "safety",
  system = "system",
}

export enum AlertSeverity {
  low = "low",
  medium = "medium",
  high = "high",
  critical = "critical",
}

export interface Alert extends Timestamps {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  relatedTable: string | null;
  relatedRecordId: string | null;
  tripId: string | null;
  machineId: string | null;
  data: Record<string, unknown> | null;
  isAcknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolutionNotes: string | null;
}
