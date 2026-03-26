-- 00004_support_tables.sql
-- Support tables: fuel_logs, consumable_logs, documents, alerts.

-- ============================================================
-- fuel_logs
-- ============================================================
CREATE TABLE fuel_logs (
  id                 UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id         UUID             NOT NULL REFERENCES machines(id),
  operator_id        UUID             REFERENCES users(id),
  parcel_id          UUID             REFERENCES parcels(id),
  logged_at          TIMESTAMPTZ      DEFAULT now(),
  fuel_type          fuel_type        NOT NULL,
  quantity_liters    NUMERIC(8,2)     NOT NULL,
  unit_price         NUMERIC(8,4),
  total_cost         NUMERIC(10,2),
  odometer_km        NUMERIC(12,2),
  hourmeter_hrs      NUMERIC(10,2),
  is_full_tank       BOOLEAN          DEFAULT false,
  receipt_photo_url  TEXT,
  notes              TEXT,
  client_id          TEXT,
  sync_version       BIGINT           DEFAULT 1,
  created_at         TIMESTAMPTZ      DEFAULT now(),
  updated_at         TIMESTAMPTZ      DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

-- ============================================================
-- consumable_logs
-- ============================================================
CREATE TABLE consumable_logs (
  id               UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id       UUID             NOT NULL REFERENCES machines(id),
  operator_id      UUID             REFERENCES users(id),
  parcel_id        UUID             REFERENCES parcels(id),
  consumable_type  consumable_type  NOT NULL,
  description      TEXT,
  quantity         NUMERIC(10,2)    NOT NULL,
  unit             TEXT             NOT NULL,
  unit_price       NUMERIC(8,4),
  total_cost       NUMERIC(10,2),
  logged_at        TIMESTAMPTZ      DEFAULT now(),
  created_at       TIMESTAMPTZ      DEFAULT now(),
  updated_at       TIMESTAMPTZ      DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- ============================================================
-- documents
-- ============================================================
CREATE TABLE documents (
  id              UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id         UUID             REFERENCES trips(id),
  document_type   document_type    NOT NULL,
  status          document_status  DEFAULT 'pending',
  title           TEXT             NOT NULL,
  file_url        TEXT,
  file_size_bytes BIGINT,
  mime_type       TEXT,
  metadata        JSONB,
  generated_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  sent_to         TEXT[],
  created_at      TIMESTAMPTZ      DEFAULT now(),
  updated_at      TIMESTAMPTZ      DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- ============================================================
-- alerts
-- ============================================================
CREATE TABLE alerts (
  id                 UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  category           alert_category   NOT NULL,
  severity           alert_severity   NOT NULL,
  title              TEXT             NOT NULL,
  description        TEXT,
  related_table      TEXT,
  related_record_id  UUID,
  trip_id            UUID             REFERENCES trips(id),
  machine_id         UUID             REFERENCES machines(id),
  data               JSONB,
  is_acknowledged    BOOLEAN          DEFAULT false,
  acknowledged_by    UUID             REFERENCES users(id),
  acknowledged_at    TIMESTAMPTZ,
  resolution_notes   TEXT,
  created_at         TIMESTAMPTZ      DEFAULT now(),
  updated_at         TIMESTAMPTZ      DEFAULT now()
);
