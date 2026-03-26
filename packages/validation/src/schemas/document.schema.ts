import { z } from "zod";
import { DocumentType, DocumentStatus } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const documentTypeSchema = z.nativeEnum(DocumentType);
export const documentStatusSchema = z.nativeEnum(DocumentStatus);

export const documentSchema = z
  .object({
    id: uuidSchema,
    tripId: uuidSchema,
    documentType: documentTypeSchema,
    status: documentStatusSchema,
    title: z.string().min(1),
    fileUrl: z.string().url().nullable(),
    fileSizeBytes: z.number().int().nonnegative().nullable(),
    mimeType: z.string().nullable(),
    metadata: z.record(z.unknown()).nullable(),
    generatedAt: isoDateSchema.nullable(),
    sentAt: isoDateSchema.nullable(),
    sentTo: z.array(z.string()).nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);
