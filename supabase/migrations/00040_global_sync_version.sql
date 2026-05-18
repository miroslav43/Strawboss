-- Fix delta sync: sync_version must be globally monotonic, not per-row.
--
-- Previously every row counted 1, 2, 3... independently (DEFAULT 1, then the
-- app did sync_version + 1 on each update). The mobile delta-pull treats
-- sync_version as a global cursor (WHERE sync_version > since), so once a
-- device's cursor reached N, every new row still sitting at version <= N was
-- permanently invisible. A freshly loaded trip stays at version 2 and never
-- reaches the driver.
--
-- Fix: a single global sequence + a BEFORE INSERT OR UPDATE trigger that
-- stamps every syncable row with the next global value.

BEGIN;

-- 1. Global monotonic sequence shared by every syncable table.
CREATE SEQUENCE IF NOT EXISTS sync_version_seq AS bigint;

-- 2. Re-stamp every existing row with a fresh global version so all devices
--    re-pull cleanly on their next sync (heals corrupted local cursors).
--    Done before the trigger exists so the sequence is consumed once per row.
UPDATE public.trips             SET sync_version = nextval('sync_version_seq');
UPDATE public.bale_loads        SET sync_version = nextval('sync_version_seq');
UPDATE public.bale_productions  SET sync_version = nextval('sync_version_seq');
UPDATE public.fuel_logs         SET sync_version = nextval('sync_version_seq');
UPDATE public.consumable_logs   SET sync_version = nextval('sync_version_seq');
UPDATE public.task_assignments  SET sync_version = nextval('sync_version_seq');
UPDATE public.machines          SET sync_version = nextval('sync_version_seq');
UPDATE public.parcels           SET sync_version = nextval('sync_version_seq');

-- 3. Trigger function: stamp every insert/update with the next global value.
CREATE OR REPLACE FUNCTION set_sync_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_version := nextval('sync_version_seq');
  RETURN NEW;
END;
$$;

-- 4. Attach a BEFORE INSERT OR UPDATE trigger to every syncable table.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'trips', 'bale_loads', 'bale_productions', 'fuel_logs',
    'consumable_logs', 'task_assignments', 'machines', 'parcels'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sync_version ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sync_version BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION set_sync_version()', tbl, tbl);
  END LOOP;
END $$;

-- 5. Index sync_version on the tables the mobile app delta-pulls.
CREATE INDEX IF NOT EXISTS idx_trips_sync_version            ON public.trips(sync_version);
CREATE INDEX IF NOT EXISTS idx_bale_loads_sync_version       ON public.bale_loads(sync_version);
CREATE INDEX IF NOT EXISTS idx_bale_productions_sync_version ON public.bale_productions(sync_version);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_sync_version        ON public.fuel_logs(sync_version);
CREATE INDEX IF NOT EXISTS idx_consumable_logs_sync_version  ON public.consumable_logs(sync_version);
CREATE INDEX IF NOT EXISTS idx_task_assignments_sync_version ON public.task_assignments(sync_version);

COMMIT;
