-- Add notification preferences JSONB column to users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';

COMMENT ON COLUMN public.users.notification_prefs IS
  'User notification preferences: {email: bool, critical: bool, trips: bool, digest: bool}';
