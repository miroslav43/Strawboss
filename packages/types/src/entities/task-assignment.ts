import type { Timestamps, SoftDelete } from "../common.js";

export enum AssignmentPriority {
  low = "low",
  normal = "normal",
  high = "high",
  urgent = "urgent",
}

export interface TaskAssignment extends Timestamps, SoftDelete {
  id: string;
  assignmentDate: string;
  machineId: string;
  parcelId: string;
  assignedUserId: string;
  priority: AssignmentPriority;
  sequenceOrder: number;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  notes: string | null;
}
