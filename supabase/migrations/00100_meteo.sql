-- 00100_meteo.sql
-- Meteo module: baling-window forecast per parcel, field moisture readings and
-- a frozen weather fingerprint per bale_productions row.
--
-- ISOLATION: this migration only CREATES new meteo_* tables. It adds no column,
-- trigger, policy or constraint to any existing table. The only references to
-- existing tables are foreign keys FROM the new tables, all ON DELETE CASCADE so
-- they can never block an existing delete. Every FK that points at an existing
-- table is declared INLINE in CREATE TABLE IF NOT EXISTS: it is created exactly
-- once and never dropped/re-added on a re-run (DROP+ADD of an FK would take a
-- lock on parcels / bale_productions on every deploy and stall mobile sync).
--
-- IDEMPOTENCY: scripts/db-migrate re-runs every file on every invocation, each
-- in its own `psql --single-transaction` WITHOUT ON_ERROR_STOP — an error rolls
-- back this whole file yet the runner still prints "ok". So: every statement is
-- re-runnable, and after a deploy confirm by hand with `\d meteo_*`.
--
-- RLS: on, with NO permissive policy (same model as 00089 / 00093 / 00098). The
-- NestJS backend is the only reader/writer; this also sidesteps the stale
-- public.user_role() enum. None of these tables join supabase_realtime.
--
-- Units: moisture is a wet-basis FRACTION; relative humidity in `hourly` JSON
-- is a FRACTION; precipitation mm/h; timestamps UTC.
SET lock_timeout = '3s';

-- ============================================================
-- 1. Per-organization opt-in + thresholds. No row = module off for that org.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_org_settings (
  organization_id      UUID         PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  enabled              BOOLEAN      NOT NULL DEFAULT false,
  enabled_at           TIMESTAMPTZ,
  threshold_wb         NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  baleable_frac_min    NUMERIC(5,4) NOT NULL DEFAULT 0.80,
  rain_prob_max        NUMERIC(5,4) NOT NULL DEFAULT 0.20,
  press_capacity_ha_h  NUMERIC(6,2) NOT NULL DEFAULT 3.0,
  min_window_h         INT          NOT NULL DEFAULT 3,
  default_mc0_wb       NUMERIC(5,4) NOT NULL DEFAULT 0.30,
  active_days          INT          NOT NULL DEFAULT 21,
  updated_by           UUID,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE meteo_org_settings DROP CONSTRAINT IF EXISTS meteo_org_settings_ranges_chk;
ALTER TABLE meteo_org_settings ADD CONSTRAINT meteo_org_settings_ranges_chk CHECK (
  threshold_wb > 0 AND threshold_wb < 1
  AND baleable_frac_min > 0 AND baleable_frac_min <= 1
  AND rain_prob_max > 0 AND rain_prob_max < 1
  AND press_capacity_ha_h > 0
  AND min_window_h BETWEEN 1 AND 24
  AND default_mc0_wb > 0 AND default_mc0_wb < 1
  AND active_days BETWEEN 1 AND 28
);

DROP TRIGGER IF EXISTS trg_meteo_org_settings_updated_at ON meteo_org_settings;
CREATE TRIGGER trg_meteo_org_settings_updated_at
  BEFORE UPDATE ON meteo_org_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. Latest forecast per grid cell and model (public data, org-agnostic, like
--    geocode_cache). coord_key = lat/lon rounded to 0.02° (~2 km), so parcels
--    close together share one row. Only the LATEST response is kept.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_forecast_latest (
  coord_key    TEXT          NOT NULL,
  model        TEXT          NOT NULL,
  lat          NUMERIC(8,5)  NOT NULL,
  lon          NUMERIC(8,5)  NOT NULL,
  issued_at    TIMESTAMPTZ,
  fetched_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  step_h       INT           NOT NULL DEFAULT 1,
  hourly       JSONB         NOT NULL,
  PRIMARY KEY (coord_key, model)
);

CREATE INDEX IF NOT EXISTS idx_meteo_forecast_latest_fetched
  ON meteo_forecast_latest (fetched_at);

-- ============================================================
-- 3. Past hours per cell, model and UTC day — appended on every ingest so the
--    drying simulation always has history back to the harvest, whatever the
--    self-hosted server keeps.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_cell_history (
  coord_key    TEXT         NOT NULL,
  model        TEXT         NOT NULL,
  day          DATE         NOT NULL,
  hourly       JSONB        NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (coord_key, model, day)
);

CREATE INDEX IF NOT EXISTS idx_meteo_cell_history_day
  ON meteo_cell_history (day);

-- ============================================================
-- 4. Drying clock: one harvest (straw left on the swath) per parcel. Started
--    BY A PERSON — harvest_status tracks baling, not the combine, so it cannot
--    say when the straw went down. A job only CLOSES events.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_harvest_events (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID         NOT NULL,
  parcel_id            UUID         NOT NULL,
  harvested_at         TIMESTAMPTZ  NOT NULL,
  harvested_at_basis   TEXT         NOT NULL DEFAULT 'manual',
  crop_type            TEXT,
  swath_type           TEXT         NOT NULL DEFAULT 'wide',
  closed_at            TIMESTAMPTZ,
  close_reason         TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  CONSTRAINT meteo_harvest_events_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT meteo_harvest_events_parcel_fkey FOREIGN KEY (organization_id, parcel_id)
    REFERENCES parcels (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE meteo_harvest_events DROP CONSTRAINT IF EXISTS meteo_harvest_events_values_chk;
ALTER TABLE meteo_harvest_events ADD CONSTRAINT meteo_harvest_events_values_chk CHECK (
  harvested_at_basis IN ('manual', 'audit_hint_confirmed')
  AND swath_type IN ('narrow', 'wide', 'turned')
  AND (close_reason IS NULL OR close_reason IN ('baled', 'expired', 'manual'))
);

-- At most one OPEN drying clock per parcel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meteo_harvest_events_open
  ON meteo_harvest_events (parcel_id)
  WHERE closed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_meteo_harvest_events_org_open
  ON meteo_harvest_events (organization_id)
  WHERE closed_at IS NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_meteo_harvest_events_updated_at ON meteo_harvest_events;
CREATE TRIGGER trg_meteo_harvest_events_updated_at
  BEFORE UPDATE ON meteo_harvest_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. Field moisture readings. `id` is generated by the client (mobile offline
--    queue) so POST is idempotent on it. bale_productions has no
--    UNIQUE (organization_id, id), so its FK is single-column and the service
--    checks the org (rule: no new constraint on existing tables).
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_moisture_readings (
  id                   UUID          PRIMARY KEY,
  organization_id      UUID          NOT NULL,
  parcel_id            UUID          NOT NULL,
  harvest_event_id     UUID,
  measured_at          TIMESTAMPTZ   NOT NULL,
  moisture_wb          NUMERIC(5,4)  NOT NULL,
  kind                 TEXT          NOT NULL,
  -- SET NULL, not CASCADE: a field measurement outlives the production row it
  -- was linked to (still never blocks a delete on bale_productions).
  bale_production_id   UUID          REFERENCES bale_productions (id) ON DELETE SET NULL,
  lat                  NUMERIC(10,7),
  lon                  NUMERIC(11,7),
  source               TEXT          NOT NULL,
  created_by           UUID,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  CONSTRAINT meteo_moisture_readings_parcel_fkey FOREIGN KEY (organization_id, parcel_id)
    REFERENCES parcels (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT meteo_moisture_readings_event_fkey FOREIGN KEY (organization_id, harvest_event_id)
    REFERENCES meteo_harvest_events (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE meteo_moisture_readings DROP CONSTRAINT IF EXISTS meteo_moisture_readings_values_chk;
ALTER TABLE meteo_moisture_readings ADD CONSTRAINT meteo_moisture_readings_values_chk CHECK (
  moisture_wb > 0 AND moisture_wb < 1
  AND kind IN ('swath', 'bale')
  AND source IN ('web', 'mobile')
);

CREATE INDEX IF NOT EXISTS idx_meteo_moisture_readings_parcel_time
  ON meteo_moisture_readings (parcel_id, measured_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_meteo_moisture_readings_updated_at ON meteo_moisture_readings;
CREATE TRIGGER trg_meteo_moisture_readings_updated_at
  BEFORE UPDATE ON meteo_moisture_readings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 6. Latest engine output per open drying clock (upserted each run). The
--    traffic-light status is NOT stored — it is derived at read time for "now".
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_straw_latest (
  harvest_event_id   UUID         PRIMARY KEY REFERENCES meteo_harvest_events (id) ON DELETE CASCADE,
  organization_id    UUID         NOT NULL,
  computed_at        TIMESTAMPTZ  NOT NULL,
  basis              JSONB        NOT NULL,
  mc0_source         TEXT,
  mc0_at             TIMESTAMPTZ,
  required_hours     INT,
  hourly             JSONB        NOT NULL,
  model_version      TEXT         NOT NULL
);

-- ============================================================
-- 7. Every engine run, kept 14 days (longer when a fingerprint points at it):
--    the fingerprint job reads "the newest run computed at or before baled_at".
--    No FK on harvest_event_id: snapshots outlive event edits by design.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_straw_snapshots (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  harvest_event_id   UUID         NOT NULL,
  organization_id    UUID         NOT NULL,
  computed_at        TIMESTAMPTZ  NOT NULL,
  basis              JSONB        NOT NULL,
  required_hours     INT,
  hourly             JSONB        NOT NULL,
  model_version      TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meteo_straw_snapshots_event_time
  ON meteo_straw_snapshots (harvest_event_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_meteo_straw_snapshots_computed
  ON meteo_straw_snapshots (computed_at);

-- ============================================================
-- 8. Frozen weather fingerprint per bale_productions row. Immutable: a
--    BEFORE UPDATE trigger rejects every change; rows are only ever inserted
--    (ON CONFLICT DO NOTHING). The ONLY foreign key is to bale_productions
--    (CASCADE, so a hard delete there still works); the other ids are plain
--    UUIDs — the canonical snapshot text is self-contained.
--    sha256 is computed over snapshot_canonical; re-verification hashes that
--    stored text, never a payload rebuilt from the typed columns.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_bale_fingerprints (
  bale_production_id     UUID          PRIMARY KEY REFERENCES bale_productions (id) ON DELETE CASCADE,
  organization_id        UUID          NOT NULL,
  parcel_id              UUID          NOT NULL,
  harvest_event_id       UUID,
  snapshot_id            UUID,
  baled_at               TIMESTAMPTZ   NOT NULL,
  baled_at_basis         TEXT          NOT NULL,
  window_status          TEXT          NOT NULL,
  run_status_at_compute  TEXT,
  rain_since_harvest_mm  NUMERIC(8,2),
  drying_hours           NUMERIC(8,2),
  mc_p10                 NUMERIC(5,4),
  mc_p50                 NUMERIC(5,4),
  mc_p90                 NUMERIC(5,4),
  mc_measured            NUMERIC(5,4),
  snapshot_canonical     TEXT          NOT NULL,
  sha256                 TEXT          NOT NULL,
  model_version          TEXT          NOT NULL,
  attribution            TEXT          NOT NULL,
  frozen_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE meteo_bale_fingerprints DROP CONSTRAINT IF EXISTS meteo_bale_fingerprints_values_chk;
ALTER TABLE meteo_bale_fingerprints ADD CONSTRAINT meteo_bale_fingerprints_values_chk CHECK (
  sha256 ~ '^[0-9a-f]{64}$'
  AND window_status IN ('green', 'yellow', 'red', 'grey')
  AND (run_status_at_compute IS NULL OR run_status_at_compute IN ('green', 'yellow', 'red', 'grey'))
  AND baled_at_basis IN ('end_time', 'start_time', 'production_date_noon')
);

CREATE INDEX IF NOT EXISTS idx_meteo_bale_fingerprints_org_parcel
  ON meteo_bale_fingerprints (organization_id, parcel_id);
CREATE INDEX IF NOT EXISTS idx_meteo_bale_fingerprints_snapshot
  ON meteo_bale_fingerprints (snapshot_id);

CREATE OR REPLACE FUNCTION meteo_bale_fingerprints_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'meteo_bale_fingerprints rows are immutable (bale_production_id=%)', OLD.bale_production_id
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_meteo_bale_fingerprints_immutable ON meteo_bale_fingerprints;
CREATE TRIGGER trg_meteo_bale_fingerprints_immutable
  BEFORE UPDATE ON meteo_bale_fingerprints
  FOR EACH ROW EXECUTE FUNCTION meteo_bale_fingerprints_immutable();

-- ============================================================
-- 9. RLS: backend service role only (bypasses RLS as table owner).
-- ============================================================
ALTER TABLE meteo_org_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_forecast_latest    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_cell_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_harvest_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_moisture_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_straw_latest       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_straw_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_bale_fingerprints  ENABLE ROW LEVEL SECURITY;
