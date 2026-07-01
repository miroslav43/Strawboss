import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN: z.coerce.number().int().positive().default(30),
  // Outbound email (Resend). Optional — without the key, email falls back to log-only.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  // No-key OSM helpers for the confirmation-email route map + distance.
  OSRM_BASE_URL: z.string().default('https://router.project-osrm.org'),
  STATICMAP_BASE_URL: z.string().default('https://staticmap.openstreetmap.de/staticmap.php'),
});

export type EnvConfig = z.infer<typeof envSchema>;
