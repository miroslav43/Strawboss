import { z } from "zod";

/** Admin UI locale — stored on users.locale, drives i18n in admin-web. */
export const updateProfileLocaleSchema = z.object({
  locale: z.enum(["en", "ro"]),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  locale: z.enum(['en', 'ro']).optional(),
  notificationPrefs: z.record(z.boolean()).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
