-- Backend sync push reads/writes result_data; original 00005 table omitted it.
-- Pull queries sync_version on every SYNCABLE_TABLES entry; several tables never had the column.

ALTER TABLE sync_idempotency
  ADD COLUMN IF NOT EXISTS result_data JSONB;

ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;

-- Idempotent if 00027 already applied:
ALTER TABLE bale_productions
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE consumable_logs
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;
