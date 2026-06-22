-- 00059_fleet_remote_commands.sql
-- Tier-1 in-app remote-debug command channel (no adb): a one-shot command QUEUE the
-- super-admin uses to send phones management/diagnostic commands — reboot, fetch_logs,
-- reinstall_apk, report_state — delivered over the existing fleet check-in. This is SEPARATE
-- from the Tailscale desired/applied channel (which stays as-is). Commands are idempotent on
-- the device (deduped by id) and re-returned each check-in until reported done/failed.
-- Backend = sole writer (service-role); RLS on, no permissive policy. Idempotent.

CREATE TABLE IF NOT EXISTS device_remote_commands (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id     UUID         NOT NULL REFERENCES devices(id),
  command_type  TEXT         NOT NULL,   -- reboot | fetch_logs | reinstall_apk | report_state
  params        JSONB,
  status        TEXT         NOT NULL DEFAULT 'pending',  -- pending | sent | completed | failed
  result        JSONB,
  last_error    TEXT,
  created_by    UUID         REFERENCES users(id),
  sent_at       TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The device pulls its outstanding commands (pending/sent) each check-in.
CREATE INDEX IF NOT EXISTS idx_device_remote_commands_pending
  ON device_remote_commands (device_id)
  WHERE status IN ('pending', 'sent');

-- History view (newest first) per device.
CREATE INDEX IF NOT EXISTS idx_device_remote_commands_device
  ON device_remote_commands (device_id, created_at DESC);

ALTER TABLE device_remote_commands ENABLE ROW LEVEL SECURITY;
-- No permissive policy: backend service-role only.

-- Latest device-reported diagnostic snapshot (from a report_state command), for quick UI display.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_state    JSONB;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_state_at TIMESTAMPTZ;
