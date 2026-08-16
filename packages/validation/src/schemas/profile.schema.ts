import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@strawboss/types';
import { signatureUrlSchema } from '../helpers/signature-url.js';

/** Limba interfeței — stocată pe users.locale, controlează i18n în admin-web și pe telefon. */
export const updateProfileLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  notificationPrefs: z.record(z.boolean()).optional(),
  signatureSpecimenUrl: signatureUrlSchema.nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

/** Plan C — heartbeat request takes no body. */
export const heartbeatRequestSchema = z.object({}).strict();
