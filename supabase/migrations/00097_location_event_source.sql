-- 00097_location_event_source.sql
-- Tag every GPS fix with WHERE it came from, so presence fixes stop painting
-- tracks.
--
-- The mobile app posts positions from two very different code paths:
--   * the location foreground service — real tracking fixes ('task');
--   * the 60 s presence alarm's best-effort path ('checkin') — deliberately
--     "last-known + Balanced" (see getBestEffortPosition in
--     apps/mobile/src/lib/location.ts), i.e. fused Wi-Fi/cell positions that
--     can land kilometres away. They exist to answer "roughly where is this
--     machine" for presence/geofence.
--
-- Both landed in machine_location_events indistinguishably. When a phone's
-- location task dies (the documented Android 14+ FGS-restart hole), the
-- check-in stream is ALL that flows — cell-tower hops at 60 s cadence that the
-- kinematic track cleaner is structurally blind to (a 4 km hop over 122 s is a
-- "legal" 118 km/h). That is the residual spider web on the Tracks page.
--
-- With the tag, the track and distance queries exclude source = 'checkin' up
-- front. NULL means "APK older than vc56" and keeps rendering as before, so
-- history and un-updated phones lose nothing.
--
-- Plain TEXT (not an enum): two known values, whitelisted server-side
-- (normalizeLocationSource), and an enum would buy type safety at the cost of
-- a migration for every future source. No index: every reader already narrows
-- by (machine_id, recorded_at) first.

ALTER TABLE machine_location_events
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN machine_location_events.source IS
  'Origin of the fix: ''task'' = location foreground service (real tracking '
  'fix), ''checkin'' = 60s presence alarm best-effort fix (network quality, '
  'presence/geofence only — excluded from tracks and distance reports), '
  'NULL = APK before vc56 (treated as task).';
