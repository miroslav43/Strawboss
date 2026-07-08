-- 00081_machine_last_positions.sql
-- One-row-per-machine last-known-position table, maintained by a trigger on
-- machine_location_events.
--
-- Root cause: the admin live map and every "where is machine X right now"
-- read (location.service.ts, geofence checks, presence dots) run a
-- `SELECT DISTINCT ON (machine_id) ... ORDER BY machine_id, recorded_at DESC`
-- over the FULL machine_location_events history on every poll. That table is
-- unbounded (one row per GPS ping per phone, every few seconds) and only
-- grows — it already needed a dedicated idempotency migration (00067) to
-- stop replay storms from duplicating rows. A history-wide scan for a single
-- "current position" is wasteful and gets slower every day, and it also
-- means the GPS retention job (trimming old events) is coupled to the live
-- map: delete too aggressively and the map goes blank for a machine that
-- simply hasn't moved in a while.
--
-- Fix: a tiny side table holding exactly the latest fix per machine, kept in
-- sync by an AFTER INSERT trigger on machine_location_events. The live map
-- reads this O(1)-per-machine table instead of scanning history, and
-- retention can delete arbitrarily old rows from machine_location_events
-- without ever blanking the map.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, backfill INSERT ... ON CONFLICT DO
-- NOTHING. Safe to re-run.

-- ============================================================
-- 1. machine_last_positions
--    Column names/types mirror machine_location_events (00009_roles_gps.sql)
--    exactly so the trigger function below is a straight column copy.
-- ============================================================
CREATE TABLE IF NOT EXISTS machine_last_positions (
  machine_id   UUID             PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  operator_id  UUID             REFERENCES users(id) ON DELETE SET NULL,
  lat          NUMERIC(10, 7)   NOT NULL,
  lon          NUMERIC(10, 7)   NOT NULL,
  coords       GEOMETRY(Point, 4326) GENERATED ALWAYS AS
                 (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED,
  accuracy_m   NUMERIC(6, 2),
  heading_deg  NUMERIC(5, 2),
  speed_ms     NUMERIC(6, 2),
  recorded_at  TIMESTAMPTZ      NOT NULL,
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mlp_coords ON machine_last_positions USING GIST (coords);

-- ============================================================
-- 2. RLS: backend service-role is the only reader/writer.
--    Same model as outbound_messages (00071_outbound_messages.sql): RLS on,
--    no permissive policy. The admin live map and mobile presence reads all
--    go through authed, org-scoped backend endpoints — never direct
--    PostgREST/anon access to this table.
-- ============================================================
ALTER TABLE machine_last_positions ENABLE ROW LEVEL SECURITY;
-- No permissive policy: backend service-role only (bypasses RLS as table
-- owner, mirrors device_remote_commands / outbound_messages).

-- ============================================================
-- 3. Trigger function: upsert the latest fix per machine.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_machine_last_position()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- machine_id is nullable on machine_location_events (ON DELETE SET NULL) --
  -- nothing to key an upsert on, so skip.
  IF NEW.machine_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO machine_last_positions (
    machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms,
    recorded_at, updated_at
  ) VALUES (
    NEW.machine_id, NEW.operator_id, NEW.lat, NEW.lon, NEW.accuracy_m,
    NEW.heading_deg, NEW.speed_ms, NEW.recorded_at, now()
  )
  ON CONFLICT (machine_id) DO UPDATE SET
    operator_id  = EXCLUDED.operator_id,
    lat          = EXCLUDED.lat,
    lon          = EXCLUDED.lon,
    accuracy_m   = EXCLUDED.accuracy_m,
    heading_deg  = EXCLUDED.heading_deg,
    speed_ms     = EXCLUDED.speed_ms,
    recorded_at  = EXCLUDED.recorded_at,
    updated_at   = now()
  -- The mobile outbox can re-post old fixes after a reconnect (00067) --
  -- never let a stale fix overwrite a newer one already recorded here.
  WHERE machine_last_positions.recorded_at <= EXCLUDED.recorded_at;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Trigger: fire on every GPS ingest.
-- ============================================================
DROP TRIGGER IF EXISTS trg_mle_last_position ON machine_location_events;
CREATE TRIGGER trg_mle_last_position
  AFTER INSERT ON machine_location_events
  FOR EACH ROW
  EXECUTE FUNCTION upsert_machine_last_position();

-- ============================================================
-- 5. Idempotent backfill from existing history so the table is populated
--    immediately for machines that already have GPS history.
-- ============================================================
INSERT INTO machine_last_positions (
  machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms,
  recorded_at, updated_at
)
SELECT DISTINCT ON (machine_id)
  machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms,
  recorded_at, now()
FROM machine_location_events
WHERE machine_id IS NOT NULL
ORDER BY machine_id, recorded_at DESC
ON CONFLICT (machine_id) DO NOTHING;
