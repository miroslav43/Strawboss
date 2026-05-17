import { z } from 'zod';

export const farmEntityTypeSchema = z.enum(['persoana_juridica', 'persoana_fizica']);

export const createFarmSchema = z.object({
  name:       z.string().min(1, 'Numele fermei este obligatoriu'),
  phone:      z.string().min(1, 'Numărul de telefon este obligatoriu'),
  entityType: farmEntityTypeSchema.optional(),
  cui:        z.string().optional(),
  apiaCode:   z.string().optional(),
  address:    z.string().optional(),
});

export const updateFarmSchema = createFarmSchema.partial();
