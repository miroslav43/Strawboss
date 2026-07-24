-- 00085_trip_destination_integrity.sql
-- Repair the trips ↔ delivery_destinations link.
--
-- Migration 00051 added `trips.destination_id` explicitly to MIRROR
-- `task_assignments.destination_id` (00018) — but NO trip-creation path ever set
-- it. Every trip in production has destination_id = NULL, which silently killed
-- an entire feature:
--   * confirmDepotDelivery() throws `no_destination`  → depot managers cannot confirm
--   * the depot-manager sync pull filters `destination_id = <their depot>` → they
--     pull ZERO trips
--   * `destination_has_operator` is always false      → the driver app always takes
--     the legacy "driver confirms" branch
--   * the depot_manager_* RLS policies (00053) match nothing
-- The backend now populates it on every own-fleet creation path. This migration
-- backfills the history and keeps the denormalized name/address honest.
--
-- Idempotent throughout. No statement can hard-fail on data.

-- ============================================================
-- 1. BACKFILL destination_id from the task the trip was planned from.
--
-- task_assignments.trip_id is the authoritative link (set by
-- autoUpsertFromTruckTask and registerLoad), and ta.destination_id is exactly
-- what trips.destination_id was meant to mirror.
--
-- TWO EXCLUSIONS, both deliberate:
--
--   a) is_auxiliary — an auxiliary trip delivers to the CUSTOMER'S yard (a free-text
--      address off the trip_request), never to one of our depots. destination_id
--      must stay NULL for it, or the depot-manager pull would start handing out
--      external transports.
--
--   b) status IN (in_transit, arrived, delivering) — THIS IS A SAFETY GATE, not an
--      optimisation. Setting destination_id flips `destination_has_operator` true
--      for any depot that has a manager assigned, and that value IS in the sync
--      pull. On the driver's next sync, EnhancedDeliveryFlow switches to a
--      read-only "wait for the depot operator" screen with NO way to proceed. Doing
--      that to a driver who is standing at the ramp right now would strand him
--      mid-delivery. Trips already en route therefore finish on the legacy path
--      exactly as they do today, and only trips not yet in the delivery window get
--      the (correct) new behaviour.
--      Consequence, accepted: the handful of trips in flight at migration time keep
--      destination_id = NULL forever and will not appear in that depot manager's
--      history. Bounded, one-off, and strictly safer than the alternative.
--
-- The UPDATE re-stamps sync_version (via set_sync_version, 00040), so phones
-- re-pull the affected trips on the next delta. That is intended — the depot
-- manager's device needs to SEE these trips for the first time.
-- ============================================================
UPDATE trips t
   SET destination_id = ta.destination_id,
       updated_at     = NOW()
  FROM task_assignments ta
 WHERE ta.trip_id = t.id
   AND ta.destination_id IS NOT NULL
   AND ta.deleted_at IS NULL
   AND t.destination_id IS NULL
   AND t.deleted_at IS NULL
   AND t.is_auxiliary = false
   AND t.status NOT IN ('in_transit'::trip_status,
                        'arrived'::trip_status,
                        'delivering'::trip_status)
   -- Never cross an org boundary, even though the link implies it.
   AND ta.organization_id IS NOT DISTINCT FROM t.organization_id;

-- ============================================================
-- 1b. BACKFILL the remainder by NAME — but only where the name is UNAMBIGUOUS.
--
-- Not every trip has a surviving task_assignments link (registerLoad's link is
-- best-effort, and old rows predate it), so step 1 alone leaves depot managers
-- with a partial history. The denormalized `destination_name` is the only other
-- evidence of where the trip went.
--
-- Matching on a name is normally a smell, so it is fenced in hard: the name must
-- resolve to EXACTLY ONE live depot in the SAME organization. If a depot was
-- renamed after the trip (no match), or two depots share a name (ambiguous), the
-- row is simply left NULL rather than guessed at — a wrong depot is far worse
-- than a missing one, because it would show a manager someone else's transport.
--
-- Same two safety gates as step 1: never auxiliary, never a trip in the delivery
-- window.
-- ============================================================
UPDATE trips t
   SET destination_id = dd.id,
       updated_at     = NOW()
  FROM delivery_destinations dd
 WHERE dd.organization_id = t.organization_id
   AND dd.deleted_at IS NULL
   AND dd.name = t.destination_name
   AND t.destination_id IS NULL
   AND t.destination_name IS NOT NULL
   AND t.deleted_at IS NULL
   AND t.is_auxiliary = false
   AND t.status NOT IN ('in_transit'::trip_status,
                        'arrived'::trip_status,
                        'delivering'::trip_status)
   -- Unambiguous only: exactly one live depot in this org bears that name.
   AND (SELECT count(*) FROM delivery_destinations d2
         WHERE d2.organization_id = t.organization_id
           AND d2.deleted_at IS NULL
           AND d2.name = t.destination_name) = 1;

-- ============================================================
-- 2. Propagate a depot RENAME to the trips that point at it.
--
-- `destination_name`/`destination_address` are denormalized onto the trip at
-- creation. Nothing kept them current, so renaming a depot left every existing
-- trip showing the old name.
--
-- SCOPED TO NON-TERMINAL TRIPS ON PURPOSE. A CMR is a legal transport document:
-- rewriting the destination of a trip that has already been delivered would
-- retroactively alter what that document says happened. Live trips are corrected;
-- history is preserved.
--
-- Mirrors farms_propagate_name_to_parcels (00065): AFTER UPDATE OF the changed
-- columns, WHEN they actually changed, SECURITY DEFINER for the direct PostgREST
-- path. The UPDATE touches only the denormalized columns — not destination_id — so
-- it cannot recurse. It re-stamps sync_version so phones pick up the new name.
-- ============================================================
CREATE OR REPLACE FUNCTION delivery_destinations_propagate_to_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE trips
     SET destination_name    = NEW.name,
         destination_address = NEW.address,
         updated_at          = NOW()
   WHERE destination_id = NEW.id
     AND deleted_at IS NULL
     -- Terminal trips keep the name they were transported under.
     AND status NOT IN ('delivered'::trip_status,
                        'completed'::trip_status,
                        'cancelled'::trip_status,
                        'disputed'::trip_status)
     AND (destination_name    IS DISTINCT FROM NEW.name
       OR destination_address IS DISTINCT FROM NEW.address);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_destinations_propagate ON delivery_destinations;
CREATE TRIGGER trg_delivery_destinations_propagate
  AFTER UPDATE OF name, address ON delivery_destinations
  FOR EACH ROW
  WHEN (OLD.name    IS DISTINCT FROM NEW.name
     OR OLD.address IS DISTINCT FROM NEW.address)
  EXECUTE FUNCTION delivery_destinations_propagate_to_trips();
