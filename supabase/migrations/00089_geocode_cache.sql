-- 00089_geocode_cache.sql
-- Server-side reverse-geocode cache: (rounded coordinate) -> nearest locality.
--
-- Why: the tasks-page machine cards (and the admin live map) want a small
-- "where is it right now — nearest locality" label per machine. Turning a
-- lat/lon into a place name means reverse geocoding, and the only reverse
-- geocoder in the repo (parcels.service.ts) hits the PUBLIC Nominatim endpoint,
-- which is rate-limited (~1 req/s) and must not be hammered. The machine
-- location feed is polled every 30 s across the whole fleet, so without a cache
-- we would issue thousands of identical lookups for machines that are parked at
-- the same coordinate.
--
-- Fix: a tiny cache keyed by the coordinate rounded to 3 decimals (~110 m). A
-- parked machine geocodes once; every later poll is a cache hit. GeocodeService
-- fills misses asynchronously, capped and rate-limited, off the request path.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ALTER ... ENABLE RLS. Safe to
-- re-run.

-- ============================================================
-- 1. geocode_cache
--    coord_key = "<lat.toFixed(3)>,<lon.toFixed(3)>" (org-agnostic; a place is
--    a place regardless of tenant). `locality` may be NULL — a cached negative
--    result (e.g. open water, or a Nominatim miss) so we do not re-hammer it.
-- ============================================================
CREATE TABLE IF NOT EXISTS geocode_cache (
  coord_key    TEXT             PRIMARY KEY,
  locality     TEXT,
  lat          NUMERIC(10, 7)   NOT NULL,
  lon          NUMERIC(10, 7)   NOT NULL,
  geocoded_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- Lets the async filler prune / re-geocode stale rows efficiently.
CREATE INDEX IF NOT EXISTS idx_geocode_cache_geocoded_at
  ON geocode_cache (geocoded_at);

-- ============================================================
-- 2. RLS: backend service-role is the only reader/writer.
--    Same model as machine_last_positions (00081) / outbound_messages (00071):
--    RLS on, no permissive policy. Reads happen only through authed, org-scoped
--    backend endpoints — never direct PostgREST/anon access.
-- ============================================================
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
-- No permissive policy: backend service-role only (bypasses RLS as table owner).
