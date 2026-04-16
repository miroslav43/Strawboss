import { z } from "zod";
import { UserRole } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const userRoleSchema = z.nativeEnum(UserRole);

export const userSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email(),
    phone: z.string().nullable(),
    fullName: z.string().min(1),
    role: userRoleSchema,
    isActive: z.boolean(),
    locale: z.string(),
    avatarUrl: z.string().url().nullable(),
    lastLoginAt: isoDateSchema.nullable(),
    assignedMachineId: z.string().uuid().nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: userRoleSchema,
  phone: z.string().nullable().optional(),
});

export const updateUserSchema = z
  .object({
    email: z.string().email(),
    fullName: z.string().min(1),
    role: userRoleSchema,
    phone: z.string().nullable(),
    isActive: z.boolean(),
    locale: z.string(),
    avatarUrl: z.string().url().nullable(),
  })
  .partial();
