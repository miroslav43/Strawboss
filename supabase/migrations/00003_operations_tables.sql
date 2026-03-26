-- 00003_operations_tables.sql
-- Operational tables: task_assignments, trips, bale_loads, bale_productions.

-- ============================================================
-- task_assignments
-- ============================================================
CREATE TABLE task_assignments (
  id                UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_date   DATE                NOT NULL,
  machine_id        UUID                REFERENCES machines(id),
  parcel_id         UUID                REFERENCES parcels(id),
  assigned_user_id  UUID                REFERENCES users(id),
  priority          assignment_priority DEFAULT 'normal',
  sequence_order    INTEGER             NOT NULL,
  estimated_start   TIMESTAMPTZ,
  estimated_end     TIMESTAMPTZ,
  actual_start      TIMESTAMPTZ,
  actual_end        TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ         DEFAULT now(),
  updated_at        TIMESTAMPTZ         DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (assignment_date, machine_id, sequence_order)
);

-- ============================================================
-- trips
-- ============================================================
CREATE TABLE trips (
  id                       UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_number              TEXT             UNIQUE NOT NULL,
  status                   trip_status      DEFAULT 'planned',
  source_parcel_id         UUID             REFERENCES parcels(id),
  source_parcel_auto       BOOLEAN          DEFAULT false,
  loader_id                UUID             REFERENCES machines(id),
  truck_id                 UUID             NOT NULL REFERENCES machines(id),
  loader_operator_id       UUID             REFERENCES users(id),
  driver_id                UUID             NOT NULL REFERENCES users(id),
  bale_count               INTEGER          DEFAULT 0,
  loading_started_at       TIMESTAMPTZ,
  loading_completed_at     TIMESTAMPTZ,
  departure_odometer_km    NUMERIC(12,2),
  departure_at             TIMESTAMPTZ,
  arrival_odometer_km      NUMERIC(12,2),
  arrival_at               TIMESTAMPTZ,
  gps_distance_km          NUMERIC(10,2),
  destination_name         TEXT,
  destination_address      TEXT,
  destination_coords       GEOMETRY(Point, 4326),
  gross_weight_kg          NUMERIC(12,2),
  tare_weight_kg           NUMERIC(12,2),
  net_weight_kg            NUMERIC(12,2)    GENERATED ALWAYS AS (gross_weight_kg - tare_weight_kg) STORED,
  weight_ticket_number     TEXT,
  weight_ticket_photo_url  TEXT,
  delivered_at             TIMESTAMPTZ,
  delivery_notes           TEXT,
  receiver_name            TEXT,
  receiver_signature_url   TEXT,
  receiver_signed_at       TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancellation_reason      TEXT,
  odometer_distance_km     NUMERIC(10,2)    GENERATED ALWAYS AS (arrival_odometer_km - departure_odometer_km) STORED,
  distance_discrepancy_km  NUMERIC(10,2),
  fraud_flags              JSONB,
  client_id                TEXT,
  sync_version             BIGINT           DEFAULT 1,
  created_at               TIMESTAMPTZ      DEFAULT now(),
  updated_at               TIMESTAMPTZ      DEFAULT now(),
  deleted_at               TIMESTAMPTZ
);

-- ============================================================
-- bale_loads
-- ============================================================
CREATE TABLE bale_loads (
  id                  UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id             UUID             NOT NULL REFERENCES trips(id),
  parcel_id           UUID             NOT NULL REFERENCES parcels(id),
  loader_id           UUID             REFERENCES machines(id),
  operator_id         UUID             REFERENCES users(id),
  bale_count          INTEGER          NOT NULL CHECK (bale_count > 0),
  loaded_at           TIMESTAMPTZ      DEFAULT now(),
  gps_lat             NUMERIC(10,7),
  gps_lon             NUMERIC(11,7),
  farmtrack_event_id  TEXT,
  notes               TEXT,
  client_id           TEXT,
  sync_version        BIGINT           DEFAULT 1,
  created_at          TIMESTAMPTZ      DEFAULT now(),
  updated_at          TIMESTAMPTZ      DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

-- ============================================================
-- bale_productions
-- ============================================================
CREATE TABLE bale_productions (
  id                    UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id             UUID             NOT NULL REFERENCES parcels(id),
  baler_id              UUID             NOT NULL REFERENCES machines(id),
  operator_id           UUID             REFERENCES users(id),
  production_date       DATE             NOT NULL,
  bale_count            INTEGER          NOT NULL CHECK (bale_count > 0),
  avg_bale_weight_kg    NUMERIC(8,2),
  start_time            TIMESTAMPTZ,
  end_time              TIMESTAMPTZ,
  farmtrack_session_id  TEXT,
  created_at            TIMESTAMPTZ      DEFAULT now(),
  updated_at            TIMESTAMPTZ      DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
