import { z } from "zod";
import { AssignmentPriority } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const assignmentPrioritySchema = z.nativeEnum(AssignmentPriority);

export const taskAssignmentSchema = z
  .object({
    id: uuidSchema,
    assignmentDate: z.string().min(1),
    machineId: uuidSchema,
    parcelId: uuidSchema,
    assignedUserId: uuidSchema,
    priority: assignmentPrioritySchema,
    sequenceOrder: z.number().int().nonnegative(),
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
  parcelId: uuidSchema,
  assignedUserId: uuidSchema,
  priority: assignmentPrioritySchema,
  sequenceOrder: z.number().int().nonnegative(),
  estimatedStart: isoDateSchema.nullable().optional(),
  estimatedEnd: isoDateSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
