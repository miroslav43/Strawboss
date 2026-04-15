import type { Timestamps, SoftDelete } from "../common.js";

export enum AssignmentPriority {
  low = "low",
  normal = "normal",
  high = "high",
  urgent = "urgent",
}

export enum AssignmentStatus {
  available = "available",
  in_progress = "in_progress",
  done = "done",
}

export interface TaskAssignment extends Timestamps, SoftDelete {
  id: string;
  assignmentDate: string;
  machineId: string;
  parcelId: string | null;
  assignedUserId: string | null;
  priority: AssignmentPriority;
  sequenceOrder: number;
  status: AssignmentStatus;
  parentAssignmentId: string | null;
  destinationId: string | null;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  notes: string | null;
}
