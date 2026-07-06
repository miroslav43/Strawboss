import { z } from 'zod';

export const createBeneficiarySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers and hyphens only'),
  displayName: z.string().min(2).max(100),
  companyName: z.string().min(2).max(200),
  email: z.string().trim().email().max(255),
  companyAddress: z.string().max(300).nullable().optional(),
  companyCui: z.string().max(20).nullable().optional(),
});
export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>;

export const updateBeneficiarySchema = createBeneficiarySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateBeneficiaryInput = z.infer<typeof updateBeneficiarySchema>;

/** Body for the beneficiary PIN verification endpoint. */
export const verifyBeneficiaryPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});
export type VerifyBeneficiaryPinInput = z.infer<typeof verifyBeneficiaryPinSchema>;
