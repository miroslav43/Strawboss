import { z } from 'zod';

export const mobileLogEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'flow', 'debug']),
  message: z.string().min(1).max(8000),
  context: z.string().max(200).optional(),
  meta: z.record(z.unknown()).optional(),
  recordedAt: z.string().optional(),
});

export const mobileLogIngestSchema = z.object({
  entries: z.array(mobileLogEntrySchema).min(1).max(200),
});

export type MobileLogIngestDto = z.infer<typeof mobileLogIngestSchema>;
export type MobileLogEntryDto = z.infer<typeof mobileLogEntrySchema>;
