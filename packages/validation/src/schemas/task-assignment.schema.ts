import { z } from "zod";
import { AssignmentPriority, AssignmentStatus } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const assignmentPrioritySchema = z.nativeEnum(AssignmentPriority);
export const assignmentStatusSchema = z.nativeEnum(AssignmentStatus);

export const taskAssignmentSchema = z
  .object({
    id: uuidSchema,
    assignmentDate: z.string().min(1),
    machineId: uuidSchema,
    parcelId: uuidSchema.nullable(),
    assignedUserId: uuidSchema.nullable(),
    priority: assignmentPrioritySchema,
    sequenceOrder: z.number().int().nonnegative(),
    status: assignmentStatusSchema,
    parentAssignmentId: uuidSchema.nullable(),
    destinationId: uuidSchema.nullable(),
    estimatedStart: isoDateSchema.nullable(),
    estimatedEnd: isoDateSchema.nullable(),
    actualStart: isoDateSchema.nullable(),
    actualEnd: isoDateSchema.nullable(),
    notes: z.string().nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createTaskAssignmentSchema = z.object({
  assignmentDate: z.string().min(1),
  machineId: uuidSchema,
  parcelId: uuidSchema.nullable().optional(),
  assignedUserId: uuidSchema.nullable().optional(),
  priority: assignmentPrioritySchema.optional().default(AssignmentPriority.normal),
  sequenceOrder: z.number().int().nonnegative(),
  status: assignmentStatusSchema.optional().default(AssignmentStatus.available),
  parentAssignmentId: uuidSchema.nullable().optional(),
  destinationId: uuidSchema.nullable().optional(),
  estimatedStart: isoDateSchema.nullable().optional(),
  estimatedEnd: isoDateSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updateAssignmentStatusSchema = z.object({
  status: assignmentStatusSchema,
});
