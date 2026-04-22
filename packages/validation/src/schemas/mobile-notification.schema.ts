import { z } from 'zod';

const broadcastTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('role'), role: z.string().min(1) }),
  z.object({ kind: z.literal('user'), userId: z.string().uuid() }),
]);

export const broadcastNotificationSchema = z.object({
  target: broadcastTargetSchema,
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
});

export type BroadcastNotificationDto = z.infer<typeof broadcastNotificationSchema>;
