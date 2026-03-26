-- 00005_audit_and_sync.sql
-- Audit logging, FarmTrack event ingestion, and offline sync idempotency.

-- ============================================================
-- audit_logs  (append-only, never deleted)
-- ============================================================
CREATE TABLE audit_logs (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name      TEXT            NOT NULL,
  record_id       UUID            NOT NULL,
  operation       audit_operation NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  changed_fields  TEXT[],
  user_id         UUID,
  client_id       TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ     DEFAULT now()
);

-- Prevent UPDATE and DELETE on audit_logs via a rule.
-- (RLS alone controls read access; this is a safety net.)
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ============================================================
-- farmtrack_events
-- ============================================================
CREATE TABLE farmtrack_events (
  id                  UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmtrack_event_id  TEXT             UNIQUE NOT NULL,
  event_type          TEXT             NOT NULL,
  device_id           TEXT             NOT NULL,
  machine_id          UUID             REFERENCES machines(id),
  geofence_id         TEXT,
  parcel_id           UUID             REFERENCES parcels(id),
  timestamp           TIMESTAMPTZ      NOT NULL,
  coords              GEOMETRY(Point, 4326),
  payload             JSONB,
  is_processed        BOOLEAN          DEFAULT false,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ      DEFAULT now()
);

-- ============================================================
-- sync_idempotency
-- ============================================================
CREATE TABLE sync_idempotency (
  client_id       TEXT        NOT NULL,
  table_name      TEXT        NOT NULL,
  record_id       UUID        NOT NULL,
  client_version  BIGINT      NOT NULL,
  server_version  BIGINT,
  processed_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (client_id, table_name, record_id, client_version)
);
