-- 00067_location_events_idempotency.sql
-- Make GPS location ingestion idempotent so a re-flushed mobile outbox can never
-- pollute the table with duplicate pings.
--
-- Root cause (observed in prod): on HONOR/MagicOS the foreground GPS service is
-- frozen by PowerGenie mid-flush, BEFORE the outbox drain is persisted. Every wake
-- re-reads and re-posts the SAME backlog, and because there was no uniqueness on
-- (operator_id, recorded_at) each replay inserted a brand-new row. One phone piled
-- up ~18k duplicate rows/day all stamped with a single 2-minute-old GPS window,
-- while its CURRENT position never advanced.
--
-- Fix: one GPS fix for one operator at one instant = one row. The backend INSERT
-- pairs with this via `ON CONFLICT DO NOTHING`, so replays become harmless no-ops.
--
-- Idempotent: the dedup keeps the lowest id per (operator_id, recorded_at); the
-- unique index uses IF NOT EXISTS. Safe to re-run.

-- 0. Block concurrent INSERTs for the (brief) dedup+index build. Without this the
--    live ingest keeps adding fresh duplicates of the very key we just cleaned
--    (a still-replaying phone re-posts the same recorded_at), so the unique index
--    build races and fails. SHARE ROW EXCLUSIVE conflicts with INSERT's ROW
--    EXCLUSIVE but still allows SELECT (presence/map reads keep working). Released
--    on COMMIT — the runner wraps this file in --single-transaction.
LOCK TABLE machine_location_events IN SHARE ROW EXCLUSIVE MODE;

-- 1. Collapse existing duplicates (keep the earliest-created row per key).
DELETE FROM machine_location_events
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY operator_id, recorded_at ORDER BY id) AS rn
    FROM machine_location_events
    WHERE operator_id IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- 2. Enforce idempotency going forward.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mle_operator_recorded
  ON machine_location_events (operator_id, recorded_at);

COMMENT ON INDEX uq_mle_operator_recorded IS
  'Idempotency key for GPS ingestion: one operator cannot be in two places at the '
  'same recorded_at. Lets the location/report INSERT use ON CONFLICT DO NOTHING so '
  'a re-flushed mobile outbox cannot create duplicate pings.';
