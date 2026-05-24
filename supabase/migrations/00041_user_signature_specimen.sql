-- 00041_user_signature_specimen.sql
--
-- Add a per-user signature specimen URL. Captured once at first login on
-- mobile for `driver` and `loader_operator` roles, and editable from the
-- profile screen on both mobile and admin-web. Used in place of an ad-hoc
-- canvas signature when the driver departs or the loader registers a load,
-- so the trip rows in `trips.driver_signature_url` / `loader_signature_url`
-- end up pointing at the same canonical image per user.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signature_specimen_url TEXT;

COMMENT ON COLUMN public.users.signature_specimen_url IS
  'Canonical signature image URL for this user (served from /api/v1/uploads/specimens/{userId}.png). '
  'Captured once at first login on mobile for driver/loader_operator roles; reused for trip departure '
  'and load-registration signatures. Editable any time from the profile screen.';
