-- 00066_devices_last_user_id.sql
-- Record which operator is logged into each fleet device, so super-admin can tell
-- the near-identical HONOR phones apart AND so operator presence can ride the most
-- stable signal (the native-alarm fleet check-in) instead of the flaky JS heartbeat.
--
-- The device self-reports its logged-in userId on every public /fleet/checkin
-- (~60s, native alarm). The backend stores it here and ALSO touches the user's
-- last_seen_at — so the existing Accounts/Tasks operator dots become reliable with
-- no frontend change.
--
-- Deliberately a PLAIN UUID, NOT a FK: the check-in is public and best-effort, so a
-- stale/garbage id must never fail a check-in. Display joins are LEFT JOINs, which
-- resolve a non-matching id to null harmlessly.
--
-- Idempotent.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_user_id UUID;

COMMENT ON COLUMN devices.last_user_id IS
  'Operator logged into the device at the last check-in (self-reported; no FK). Null when logged out.';
