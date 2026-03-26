import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";

export const syncMutationSchema = z.object({
  table: z.string().min(1),
  recordId: uuidSchema,
  action: z.enum(["insert", "update", "delete"]),
  data: z.record(z.unknown()),
  clientId: z.string().min(1),
  clientVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
});

export const syncPushRequestSchema = z.object({
  mutations: z.array(syncMutationSchema),
});

export const syncPullRequestSchema = z.object({
  tables: z.record(z.number().int().nonnegative()),
});
