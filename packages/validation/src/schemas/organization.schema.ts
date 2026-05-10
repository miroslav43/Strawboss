import { z } from 'zod';

export const createOrganizationSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  name: z.string().min(2).max(100),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
