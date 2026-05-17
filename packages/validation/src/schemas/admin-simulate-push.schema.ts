import { z } from 'zod';

const simulateEventEnum = z.enum([
  'field_entry',
  'deposit_entry',
  'truck_arrived_at_loader',
  'trip_loaded',
  'trip_departed',
  'trip_arrived',
  'trip_completed',
  'trip_disputed',
  'broadcast',
]);

export const adminSimulatePushSchema = z.object({
  userId: z.string().uuid(),
  event: simulateEventEnum,
  /** Flat string map (e.g. plate, parcel, warehouse, title, body for broadcast). */
  vars: z.record(z.string(), z.string()).optional(),
});

export type AdminSimulatePushDto = z.infer<typeof adminSimulatePushSchema>;
