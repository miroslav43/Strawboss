import { z } from "zod";
import { AuditOperation } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";

export const auditOperationSchema = z.nativeEnum(AuditOperation);

export const auditLogSchema = z.object({
  id: uuidSchema,
  tableName: z.string().min(1),
  recordId: uuidSchema,
  operation: auditOperationSchema,
  oldValues: z.record(z.unknown()).nullable(),
  newValues: z.record(z.unknown()).nullable(),
  changedFields: z.array(z.string()).nullable(),
  userId: uuidSchema.nullable(),
  clientId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: isoDateSchema,
});
