import { z } from 'zod';

export const createFarmSchema = z.object({
  name:    z.string().min(1, 'Numele fermei este obligatoriu'),
  address: z.string().optional(),
});

export const updateFarmSchema = createFarmSchema.partial();
