-- 00071_outbound_messages.sql
-- Unified outbox for real outbound email (Resend) + SMS (delivered by a custom
-- SIM-gateway Android app that polls /fleet/checkin, like device_remote_commands).
-- Backend is the sole writer/reader (service-role). RLS on, no permissive policy.
-- The admin monitor reads it via an authed, org-scoped backend endpoint.

CREATE TABLE IF NOT EXISTS outbound_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: some system notifications aren't org-scoped. The monitor is
  -- org-scoped, so org-less rows simply don't appear there (still logged/sent).
  organization_id     UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  channel             TEXT        NOT NULL CHECK (channel IN ('email', 'sms')),
  kind                TEXT        NOT NULL,
  to_address          TEXT        NOT NULL,
  subject             TEXT,
  body                TEXT        NOT NULL,
  html                TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  provider_message_id TEXT,
  error               TEXT,
  attempts            INT         NOT NULL DEFAULT 0,
  trip_request_id     UUID,
  claimed_by_device   UUID,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Poll/queue index: pending or in-flight rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_outbound_messages_pending
  ON outbound_messages (channel, created_at)
  WHERE status IN ('pending', 'sent');

-- Admin monitor index: newest first per org.
CREATE INDEX IF NOT EXISTS idx_outbound_messages_org
  ON outbound_messages (organization_id, created_at DESC);

ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
-- No permissive policy: backend service-role only (mirrors device_remote_commands).

-- Only phones flagged as SMS gateways receive pending SMS to send via their SIM.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS is_sms_gateway BOOLEAN NOT NULL DEFAULT false;
