-- 00078_sync_idempotency_org_scope.sql
--
-- LOW-tier audit finding L7: SyncService.applyMutation()'s idempotency
-- fast-path looked up sync_idempotency by (client_id, table_name, record_id,
-- client_version) only — no organization filter. Since result_data is the
-- full applied row, a client that guessed/observed another org's tuple could
-- replay it and get that org's cached row back. Add organization_id and have
-- the backend match it on lookup (backend/service/src/sync/sync.service.ts).
--
-- Idempotent: safe to re-run.

ALTER TABLE sync_idempotency
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_sync_idempotency_org
  ON sync_idempotency (organization_id);
