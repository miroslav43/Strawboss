-- 00043_trip_multi_iteration_and_presence.sql
-- Plan C — multi-iteration trips, loader recall, presence heartbeat,
--          truck-idle detection support, deposit inventory query support.
--
-- Idempotent: every DDL is guarded with IF NOT EXISTS or DO $$ EXCEPTION blocks.
-- RLS: no new tables (only columns + index changes), so existing trip/user policies
--      apply unchanged.

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so we
-- run it before BEGIN. It is idempotent via IF NOT EXISTS.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'depot_manager';

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) users.last_seen_at — server-side presence heartbeat
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Partial index: only living users with a heartbeat (fast "online now" query)
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
  ON users (last_seen_at DESC)
  WHERE deleted_at IS NULL AND last_seen_at IS NOT NULL;

COMMENT ON COLUMN users.last_seen_at IS
  'Updated by POST /profile/heartbeat (mobile every 30 s). NULL = never connected.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2) trips multi-iteration columns
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN parent_trip_id UUID
    REFERENCES trips(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN iteration_index INTEGER NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_trips_iteration_index_positive
    CHECK (iteration_index >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Same parent ⇒ iteration_index must be unique. We use a partial unique
-- index so cancelled / deleted iterations don't block re-use.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_parent_iteration
  ON trips (parent_trip_id, iteration_index)
  WHERE deleted_at IS NULL AND parent_trip_id IS NOT NULL;

-- Fast "find iterations for this course" query.
CREATE INDEX IF NOT EXISTS idx_trips_parent_trip_id
  ON trips (parent_trip_id)
  WHERE deleted_at IS NULL;

-- Used by the truck-idle BullMQ job (find open trips per truck cheaply).
CREATE INDEX IF NOT EXISTS idx_trips_truck_status_open
  ON trips (truck_id, status)
  WHERE deleted_at IS NULL
    AND status IN ('planned', 'loading', 'loaded', 'in_transit', 'arrived', 'delivering');

COMMENT ON COLUMN trips.parent_trip_id IS
  'NULL = root trip of a course. Non-NULL = iteration N>=2 of the same course.';
COMMENT ON COLUMN trips.iteration_index IS
  'Position within the course, 1-based. 1 = first trip on the parcel; auto-incremented per parent_trip_id.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3) sync_version bump: existing trips (iteration_index defaulted to 1)
--    must be pulled by every mobile client so they see the new column.
--    We use the global sync trigger from 00040 — touching updated_at
--    is enough to increment sync_version (trigger handles it).
-- ──────────────────────────────────────────────────────────────────────────
UPDATE trips
   SET updated_at = NOW()
 WHERE deleted_at IS NULL
   AND parent_trip_id IS NULL
   AND iteration_index = 1;

-- ──────────────────────────────────────────────────────────────────────────
-- 4) Helper view: trip_courses (read-only, no DDL guard needed for views)
--    Aggregates a course (root trip + its descendants) into one row with
--    counts. Used by admin dashboards and the deposit incoming list.
-- ──────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS trip_courses;
CREATE VIEW trip_courses AS
WITH RECURSIVE course_tree AS (
  -- roots
  SELECT
    id           AS course_root_id,
    id           AS trip_id,
    source_parcel_id,
    truck_id,
    iteration_index,
    status,
    bale_count,
    created_at,
    completed_at
  FROM trips
  WHERE parent_trip_id IS NULL
    AND deleted_at IS NULL
  UNION ALL
  SELECT
    ct.course_root_id,
    t.id,
    t.source_parcel_id,
    t.truck_id,
    t.iteration_index,
    t.status,
    t.bale_count,
    t.created_at,
    t.completed_at
  FROM trips t
  JOIN course_tree ct ON t.parent_trip_id = ct.trip_id
  WHERE t.deleted_at IS NULL
)
SELECT
  course_root_id,
  COUNT(*)                                                     AS iteration_count,
  MAX(iteration_index)                                         AS last_iteration_index,
  SUM(CASE WHEN status = 'completed' THEN bale_count ELSE 0 END) AS total_delivered_bales,
  BOOL_OR(status IN ('loaded','in_transit','arrived','delivering','delivered','loading','planned'))
                                                                AS has_open_iteration,
  MIN(created_at)                                              AS started_at,
  MAX(completed_at)                                            AS last_completed_at
FROM course_tree
GROUP BY course_root_id;

COMMENT ON VIEW trip_courses IS
  'Plan C — aggregates a multi-iteration trip course into a single row. Read-only.';

-- ──────────────────────────────────────────────────────────────────────────
-- 5) RLS: no new tables. The existing per-row trip / user policies cover
--    parent_trip_id and iteration_index transparently.
-- ──────────────────────────────────────────────────────────────────────────

COMMIT;
