import { z } from "zod";
import { UserRole } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const userRoleSchema = z.nativeEnum(UserRole);

// Only roles an org admin is allowed to assign — super_admin is excluded
const adminAssignableRoleSchema = z.enum([
  'admin',
  'dispatcher',
  'loader_operator',
  'driver',
  'baler_operator',
] as const);

export const userSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email(),
    username: z.string().nullable(),
    pin: z.string().nullable(),
    phone: z.string().nullable(),
    fullName: z.string().min(1),
    role: userRoleSchema,
    isActive: z.boolean(),
    locale: z.string(),
    avatarUrl: z.string().url().nullable(),
    lastLoginAt: isoDateSchema.nullable(),
    assignedMachineId: z.string().uuid().nullable(),
    organizationId: uuidSchema.nullable().optional(),
    organizationSlug: z.string().min(1).nullable().optional(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

/** Exactly two words: Surname Firstname (e.g. "Maletici Miroslav"). */
const fullNameTwoWords = z
  .string()
  .regex(/^\S+\s+\S+$/, 'Introduceți exact 2 cuvinte: Nume Prenume');

export const createUserSchema = z.object({
  fullName: fullNameTwoWords,
  role: adminAssignableRoleSchema,
  phone: z.string().nullable().optional(),
  /** Optional: admin can override the auto-generated username before submit. */
  usernameOverride: z.string().min(3).optional(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().min(1),
    role: adminAssignableRoleSchema,
    phone: z.string().nullable(),
    isActive: z.boolean(),
    locale: z.string(),
    avatarUrl: z.string().url().nullable(),
    /** Admin can change the username (must be unique). */
    username: z.string().min(3),
    /** Admin can change the 4-digit PIN (also updates Supabase Auth password). */
    pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
    assignedMachineId: z.string().uuid().nullable(),
  })
  .partial();
