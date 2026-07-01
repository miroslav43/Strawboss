-- 00069_retire_completed_aux_trucks.sql
-- One-time backfill: retire (soft-delete) one-time auxiliary trucks whose trip is
-- already `completed`, so they drop out of the fleet / trucks list. The row stays
-- in the DB and is still readable for CMR + trip history (those read the machine by
-- truck_id WITHOUT a deleted_at filter). Going forward this happens automatically
-- at aux-trip completion (registerLoadForAuxiliary). Idempotent — the deleted_at
-- IS NULL guard makes re-runs no-ops.

UPDATE machines m
SET deleted_at = NOW(), updated_at = NOW()
WHERE m.is_auxiliary = true
  AND m.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM trips t
    WHERE t.truck_id = m.id
      AND t.status = 'completed'::trip_status
  );
