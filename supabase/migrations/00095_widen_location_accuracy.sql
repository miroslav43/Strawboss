-- 00095_widen_location_accuracy.sql
-- Widen machine_location_events.accuracy_m so a very poor GPS fix cannot take
-- down location ingestion.
--
-- The column was created as NUMERIC(6,2) in 00009, i.e. a hard ceiling of
-- 9999.99. That looked generous for a "horizontal accuracy in metres" until the
-- fleet started producing cell-tower fallback fixes: production has already
-- stored a 9906.20 m estimate, ~94 m below the ceiling.
--
-- One fix at 10 km would raise `numeric field overflow`. On the single-report
-- path that is a 500; on the batch path it fails the whole 30-report INSERT.
-- The mobile outbox only discards a batch on 400/403 (see
-- isBatchPermanentDropError in apps/mobile/src/lib/location.ts) and treats every
-- 5xx as transient, so it would re-post the same doomed batch indefinitely —
-- the same retry-storm shape that commit 5a38ed8 had to put down once already.
--
-- NUMERIC(9,2) tops out at 9 999 999.99 m, far beyond any value a GNSS stack
-- will ever emit, and the backend additionally clamps to that bound
-- (clampAccuracyM in backend/service/src/common/gps-noise.ts) so old APKs in the
-- field are covered too.
--
-- Widening a NUMERIC is a metadata-only change in Postgres when precision and
-- scale both grow and scale is unchanged — no table rewrite, no lock beyond a
-- brief ACCESS EXCLUSIVE. Idempotent: re-running is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'machine_location_events'
      AND column_name = 'accuracy_m'
      AND numeric_precision = 6
  ) THEN
    ALTER TABLE machine_location_events
      ALTER COLUMN accuracy_m TYPE NUMERIC(9, 2);
  END IF;
END $$;

COMMENT ON COLUMN machine_location_events.accuracy_m IS
  'Device-reported horizontal accuracy in metres. Widened from NUMERIC(6,2) in '
  '00095 because a cell-tower fallback fix can exceed 9999.99 and overflow was '
  'turning ingestion into an infinite mobile retry storm. Values above '
  'ACCURACY_CAP_M (100 m) are excluded from tracks and distance reports.';
