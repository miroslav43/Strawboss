-- 00048_trip_recall_decision.sql
-- Plan C — structured loader-recall decision on trips.
--
-- Replaces the fragile free-form `delivery_notes` markers
-- ([recall_yes:...] / [recall_no:...]) with two structured, server-managed
-- columns so the loader-recall response can be made idempotent:
--   - createNextIteration (recall=true)  sets recall_decision='recalled'
--   - recordNoRecall      (recall=false) sets recall_decision='declined'
-- A second response for an already-decided trip is rejected (no duplicate
-- iterations, no duplicate decline alerts).
--
-- Server-managed only: mobile never reads or writes these, so they are NOT
-- added to sync ALLOWED_COLUMNS and no sync_version bump is required.
--
-- Idempotent: every DDL is guarded with IF NOT EXISTS / DO $$ EXCEPTION blocks.
-- RLS: no new tables (only columns), so existing per-row trip policies apply
--      unchanged.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) trips.recall_decision — the loader's answer to "recall the truck?"
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN recall_decision TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_trips_recall_decision
    CHECK (recall_decision IS NULL OR recall_decision IN ('recalled', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) trips.recall_decided_at — when the decision was recorded (idempotency key)
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN recall_decided_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMENT ON COLUMN trips.recall_decision IS
  'Plan C loader-recall answer: NULL = not yet answered, ''recalled'' = loader called the truck back (a next iteration was minted), ''declined'' = loader released the truck (admin alerted). Server-managed; replaces delivery_notes [recall_*] markers.';
COMMENT ON COLUMN trips.recall_decided_at IS
  'Timestamp the recall_decision was recorded. Used as the idempotency guard so a second response for the same trip is rejected.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3) RLS: no new tables. Existing per-row trip policies cover the new columns
--    transparently. No sync_version bump (columns are server-internal).
-- ──────────────────────────────────────────────────────────────────────────

COMMIT;
