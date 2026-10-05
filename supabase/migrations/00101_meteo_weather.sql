-- 00101_meteo_weather.sql
-- Meteo iteration 2: alert settings, ERA5 climate normals + daily actuals, the
-- meteo alert feed (with its dedupe key) and the per-user notification cap.
--
-- ISOLATION: the only ALTER is on meteo_org_settings, a table this module owns
-- (00100). Everything else is a NEW meteo_* table. Foreign keys point only at
-- organizations, are declared inline (created once, never dropped/re-added) and
-- cascade. Interactive per-parcel weather is NOT stored here — it lives in
-- Redis with a TTL; these tables hold only climatology and alerts.
--
-- IDEMPOTENCY: scripts/db-migrate re-runs every file each time, in its own
-- `psql --single-transaction` WITHOUT ON_ERROR_STOP (an error rolls the whole
-- file back yet prints "ok"), so every statement is re-runnable; confirm by
-- hand with `\d meteo_*` after a deploy.
--
-- RLS: on, no permissive policy (backend service role only), like 00100.
SET lock_timeout = '3s';

-- ============================================================
-- 1. Alert opt-in + thresholds on our own settings table. Constant defaults →
--    metadata-only ADD COLUMN, no rewrite.
-- ============================================================
ALTER TABLE meteo_org_settings
  ADD COLUMN IF NOT EXISTS alerts_enabled     BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerts_email       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_frost_c      NUMERIC(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_heat_c       NUMERIC(4,1) NOT NULL DEFAULT 32,
  ADD COLUMN IF NOT EXISTS alert_gust_ms      NUMERIC(4,1) NOT NULL DEFAULT 17,
  ADD COLUMN IF NOT EXISTS alert_rain_mm      NUMERIC(5,1) NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS alert_cape_jkg     INT          NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS alert_lookahead_h  INT          NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS alerts_updated_by  UUID;

ALTER TABLE meteo_org_settings DROP CONSTRAINT IF EXISTS meteo_org_settings_alerts_chk;
ALTER TABLE meteo_org_settings ADD CONSTRAINT meteo_org_settings_alerts_chk CHECK (
  alert_frost_c BETWEEN -10 AND 5
  AND alert_heat_c BETWEEN 25 AND 45
  AND alert_gust_ms BETWEEN 8 AND 40
  AND alert_rain_mm BETWEEN 5 AND 200
  AND alert_cape_jkg BETWEEN 300 AND 5000
  AND alert_lookahead_h BETWEEN 24 AND 48
);

-- ============================================================
-- 2. 1991–2020 climate normals per 0.25° cell (public ERA5 data, org-agnostic
--    like geocode_cache; no FK). Filled lazily by the meteo-climate job.
--    source_host tags rows fetched from the PUBLIC (non-commercial) archive so
--    proof-of-concept data can be purged before commercial use.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_climate_normals (
  cell_key       TEXT          PRIMARY KEY,
  lat            NUMERIC(7,4)  NOT NULL,
  lon            NUMERIC(7,4)  NOT NULL,
  status         TEXT          NOT NULL DEFAULT 'pending',
  period         TEXT          NOT NULL DEFAULT '1991-2020',
  model          TEXT,
  source_host    TEXT,
  years          INT,
  doy_tmean      JSONB,
  doy_precip     JSONB,
  doy_gdd0       JSONB,
  doy_gdd5       JSONB,
  monthly        JSONB,
  attempts       INT           NOT NULL DEFAULT 0,
  last_error     TEXT,
  requested_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  fetched_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE meteo_climate_normals DROP CONSTRAINT IF EXISTS meteo_climate_normals_values_chk;
ALTER TABLE meteo_climate_normals ADD CONSTRAINT meteo_climate_normals_values_chk CHECK (
  status IN ('pending', 'ready', 'failed')
  -- IS NOT NULL first: jsonb_typeof(NULL) is NULL, and a NULL CHECK passes.
  AND (status <> 'ready' OR (
    doy_tmean IS NOT NULL AND doy_precip IS NOT NULL
    AND jsonb_typeof(doy_tmean) = 'array' AND jsonb_array_length(doy_tmean) = 366
    AND jsonb_typeof(doy_precip) = 'array' AND jsonb_array_length(doy_precip) = 366
  ))
);

CREATE INDEX IF NOT EXISTS idx_meteo_climate_normals_status
  ON meteo_climate_normals (status, requested_at);

DROP TRIGGER IF EXISTS trg_meteo_climate_normals_updated_at ON meteo_climate_normals;
CREATE TRIGGER trg_meteo_climate_normals_updated_at
  BEFORE UPDATE ON meteo_climate_normals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. Daily actuals per climate cell (ERA5 archive), for month-to-date,
--    last-30-days anomalies and season GDD. Current + previous year only.
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_climate_daily (
  cell_key     TEXT          NOT NULL,
  day          DATE          NOT NULL,
  tmean_c      NUMERIC(5,2),
  precip_mm    NUMERIC(6,2),
  source_host  TEXT,
  fetched_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (cell_key, day)
);

CREATE INDEX IF NOT EXISTS idx_meteo_climate_daily_day
  ON meteo_climate_daily (day);

-- ============================================================
-- 4. Alert feed. One row per (org, type, 0.05° cell, local day): the UNIQUE
--    key IS the dedupe, so two replicas evaluating the same hour can never
--    double-insert. parcel_ids / acknowledged_by carry no FK (≤50 ids, and a
--    feed row must never block a delete elsewhere).
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_alerts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID          NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  alert_type        TEXT          NOT NULL,
  severity          TEXT          NOT NULL,
  cell_key          TEXT          NOT NULL,
  local_day         DATE          NOT NULL,
  starts_at         TIMESTAMPTZ   NOT NULL,
  ends_at           TIMESTAMPTZ   NOT NULL,
  peak_at           TIMESTAMPTZ   NOT NULL,
  peak_value        NUMERIC(7,2)  NOT NULL,
  threshold         NUMERIC(7,2)  NOT NULL,
  parcel_ids        UUID[]        NOT NULL DEFAULT '{}',
  parcel_count      INT           NOT NULL DEFAULT 0,
  details           JSONB         NOT NULL DEFAULT '{}',
  notified_at       TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_meteo_alerts_dedupe UNIQUE (organization_id, alert_type, cell_key, local_day)
);

ALTER TABLE meteo_alerts DROP CONSTRAINT IF EXISTS meteo_alerts_values_chk;
ALTER TABLE meteo_alerts ADD CONSTRAINT meteo_alerts_values_chk CHECK (
  alert_type IN ('frost', 'storm', 'wind', 'heavy_rain', 'heat')
  AND severity IN ('warning', 'severe')
  AND ends_at >= starts_at
  AND parcel_count >= 0
);

CREATE INDEX IF NOT EXISTS idx_meteo_alerts_org_day
  ON meteo_alerts (organization_id, local_day DESC);
CREATE INDEX IF NOT EXISTS idx_meteo_alerts_pending
  ON meteo_alerts (organization_id)
  WHERE notified_at IS NULL;

DROP TRIGGER IF EXISTS trg_meteo_alerts_updated_at ON meteo_alerts;
CREATE TRIGGER trg_meteo_alerts_updated_at
  BEFORE UPDATE ON meteo_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. Notification cap ledger: ≤3 pushes and ≤3 emails per user per local day,
--    incremented atomically (INSERT … ON CONFLICT DO UPDATE … WHERE count < 3).
-- ============================================================
CREATE TABLE IF NOT EXISTS meteo_alert_notifications (
  user_id           UUID          NOT NULL,
  local_day         DATE          NOT NULL,
  organization_id   UUID          NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  push_count        INT           NOT NULL DEFAULT 0,
  email_count       INT           NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_day)
);

-- ============================================================
-- 6. RLS: backend service role only.
-- ============================================================
ALTER TABLE meteo_climate_normals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_climate_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteo_alert_notifications  ENABLE ROW LEVEL SECURITY;
