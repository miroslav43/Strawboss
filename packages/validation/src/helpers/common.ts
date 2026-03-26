import { z } from "zod";
import { isoDateSchema } from "./iso-date.js";

export const timestampsSchema = z.object({
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const softDeleteSchema = z.object({
  deletedAt: isoDateSchema.nullable(),
});
