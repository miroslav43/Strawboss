-- Offline sync pull/push expects sync_version on all SYNCABLE_TABLES.
-- Inserts from mobile sync always set sync_version = 1 on the server.

ALTER TABLE bale_productions
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE consumable_logs
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;
