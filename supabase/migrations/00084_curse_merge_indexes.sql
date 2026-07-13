-- 00084_curse_merge_indexes.sql
-- Index + realtime support for the merged "Curse" page, which renders two
-- delimited ledgers: auxiliary transports (anchored on trip_requests, with their
-- live trip joined in) and own-fleet trips (trips WHERE is_auxiliary = false).
--
-- Indexes only. Every statement is idempotent and none can fail on data — there
-- is no backfill, no constraint and no type change here, so this migration
-- cannot abort halfway and leave the schema in a partial state.
--
-- Deliberately NOT shipped here: a partial UNIQUE on trip_requests(machine_id).
-- It looks right (one aux machine per request), but confirm() is NOT
-- transactional — trip-requests.service.ts runs the `INSERT INTO machines` and
-- the `UPDATE trip_requests` as two independent statements — so a retry can mint
-- a duplicate aux machine. Adding that constraint could therefore HARD-FAIL on
-- existing production rows and roll these perf indexes back with it. Audit first
-- (SELECT machine_id, count(*) FROM trip_requests WHERE machine_id IS NOT NULL
--  AND deleted_at IS NULL GROUP BY 1 HAVING count(*) > 1), then constrain in its
-- own migration.

-- ============================================================
-- trips → the request that spawned it.
-- Feeds the LEFT JOIN LATERAL that attaches an auxiliary request's live trip
-- (TripRequestsService.TR_TRIP_JOIN). Joined on trip_request_id — the STABLE
-- direction — rather than the last-write-wins trip_requests.trip_id pointer.
-- Partial: only auxiliary trips carry a trip_request_id at all.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trips_trip_request
  ON trips (trip_request_id)
  WHERE deleted_at IS NULL AND trip_request_id IS NOT NULL;

-- ============================================================
-- The fleet ledger's exact access path: one organization, one kind of trip,
-- newest first. Matches the query column-for-column INCLUDING the sort
-- direction and the soft-delete predicate, so it can satisfy both the filter and
-- the ORDER BY. Today only separate single-column indexes exist and the planner
-- has to bitmap-AND them and then sort.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trips_org_aux_created
  ON trips (organization_id, is_auxiliary, created_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================
-- The aux ledger's access path. 00054 indexed (organization_id) and
-- (organization_id, status), but nothing covers the ORDER BY created_at DESC
-- that both the list and its new pagination depend on.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trip_requests_org_created
  ON trip_requests (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Realtime: the merged Curse page is now the ONLY place a new portal request
-- surfaces, so the admin must see it land without a refresh. trip_requests was
-- never in the realtime publication.
--
-- Publication membership is managed out-of-band (the Supabase dashboard) — a
-- grep of supabase/ finds no other reference to supabase_realtime, so this repo
-- cannot prove the current state. Both plausible failures are therefore caught
-- and swallowed: duplicate_object (already a member) and insufficient_privilege
-- (the migration role does not own the publication). Neither may abort the
-- migration and take the indexes above down with it.
--
-- If this ends up a no-op, the UI degrades gracefully rather than breaking: the
-- table still self-heals on window focus (60s staleTime + refetchOnWindowFocus)
-- and every mutation already invalidates the query on success.
-- ============================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trip_requests;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'trip_requests is already in the supabase_realtime publication.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Cannot alter supabase_realtime (not the owner) — add trip_requests via the Supabase dashboard.';
  WHEN undefined_object THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist — skipping.';
END $$;
