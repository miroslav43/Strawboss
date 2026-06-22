-- 00057_fleet_tailscale_oauth_apk.sql
-- Two follow-ups to the Tailscale remote-access feature (00056):
--   1. OAuth client → mint EPHEMERAL, single-use, tagged auth keys per device on demand
--      (so the long-lived shared key is never broadcast to phones — closes the HIGH finding).
--   2. A hosted Tailscale APK so the Device-Owner app can SILENTLY self-install the official
--      Tailscale app on phones that don't have it yet (zero-touch provisioning).
-- All columns on the existing app_settings singleton. Secrets are service-role only (RLS
-- already enabled in 00056, no permissive policy). Idempotent.

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_oauth_client_id     TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_oauth_client_secret TEXT;
-- Tag applied to OAuth-minted keys (Tailscale requires tagged keys for OAuth clients),
-- e.g. 'tag:fleet-phone'. Must exist in the tailnet ACL.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_tag                 TEXT;
-- Hosted official Tailscale APK (stored like our release APKs, served via signed URL).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_apk_key             TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_apk_sha256          TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tailscale_apk_size            BIGINT;
