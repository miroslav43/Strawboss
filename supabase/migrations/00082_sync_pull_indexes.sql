-- 00082_sync_pull_indexes.sql
-- Index the actual predicate shape of /sync/pull (sync.service.ts, ~L790-882):
--
--   WHERE (sync_version > $since OR <force-include arm>) <owner filter>
--         <soft-delete filter> AND organization_id = $org
--   ORDER BY sync_version ASC
--
-- Every pull is organization-scoped (orgFilter, `AND organization_id = ...`),
-- but the sync_version indexes added by 00040_global_sync_version.sql
-- (idx_trips_sync_version, idx_bale_loads_sync_version, etc.) are single-
-- column. With a global sync_version sequence shared across ALL orgs
-- (00040), a single-org filter on `sync_version > since` can't use a plain
-- sync_version index to prune the other tenants' rows -- Postgres has to
-- scan/filter every row with a higher global version, not just this org's.
-- A composite (organization_id, sync_version) index lets the planner seek
-- straight to this org's slice.
--
-- trips and task_assignments additionally OR-in a force-include arm (see
-- 00043_trip_multi_iteration_and_presence.sql / the delta-sync-version-skew
-- comment in sync.service.ts) so every pull also re-sends the operationally
-- "live" slice regardless of cursor position. Index that arm too:
--   - trips: `status NOT IN ('completed', 'cancelled')`
--   - task_assignments: `assignment_date = <today>`
--
-- Idempotent: all CREATE INDEX IF NOT EXISTS. Safe to re-run.

-- trips: organization_id + sync_version have both been NOT NULL since
-- 00036_organizations.sql / 00003_operations_tables.sql respectively.
CREATE INDEX IF NOT EXISTS idx_trips_org_sync
  ON trips (organization_id, sync_version);

-- Force-include arm: `status NOT IN ('completed', 'cancelled')` -- same
-- unquoted enum-literal style as the existing trips partial indexes/policies
-- (e.g. 00008_rls_policies.sql, 00043_trip_multi_iteration_and_presence.sql),
-- relying on Postgres's implicit unknown-literal-to-enum cast.
CREATE INDEX IF NOT EXISTS idx_trips_org_nonterminal
  ON trips (organization_id)
  WHERE status NOT IN ('completed', 'cancelled');

-- task_assignments: organization_id (00036) + sync_version (00028) + the
-- assignment_date used by the "today" force-include arm.
CREATE INDEX IF NOT EXISTS idx_ta_org_sync
  ON task_assignments (organization_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_ta_org_date
  ON task_assignments (organization_id, assignment_date);

-- bale_loads / bale_productions / fuel_logs / consumable_logs: all four have
-- organization_id (00036) and sync_version (00027/00028) and are pulled with
-- an additional `operator_id = caller` ownerFilter for non-admin roles, but
-- the org+version pair is still the primary prune -- that ownerFilter is a
-- small in-memory equality check applied after the index narrows to this
-- org's delta.
CREATE INDEX IF NOT EXISTS idx_bale_loads_org_sync
  ON bale_loads (organization_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_bale_productions_org_sync
  ON bale_productions (organization_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_fuel_logs_org_sync
  ON fuel_logs (organization_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_consumable_logs_org_sync
  ON consumable_logs (organization_id, sync_version);

-- parcels / machines: organization_id (00036) + sync_version (00040 backfill
-- / 00028 column-add). No ownerFilter or force-include arm -- pure delta.
CREATE INDEX IF NOT EXISTS idx_parcels_org_sync
  ON parcels (organization_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_machines_org_sync
  ON machines (organization_id, sync_version);
