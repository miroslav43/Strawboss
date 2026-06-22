-- 00058_fleet_command_hardening.sql
-- Hardening from the code review of the fleet command channel:
--   1. Persist the issued Tailscale command (id + action) so a device can't forge a
--      completion report, and so `applied` is set from the ISSUED action (not the current
--      `desired`, which may have flipped mid-flight).
--   2. Track the last OAuth key-mint failure so we back off instead of hammering the
--      Tailscale API on every check-in when minting is permanently failing.
-- Idempotent.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_pending_command_id UUID;
-- 'up' | 'down' — the action carried by the currently-outstanding command.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_pending_action     TEXT;

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_mint_failed_at TIMESTAMPTZ;
