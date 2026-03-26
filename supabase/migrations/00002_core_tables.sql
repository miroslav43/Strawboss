-- 00002_core_tables.sql
-- Core entity tables: users, parcels, machines, delivery_destinations.

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT        UNIQUE NOT NULL,
  phone           TEXT,
  full_name       TEXT        NOT NULL,
  role            user_role   NOT NULL DEFAULT 'driver',
  password_hash   TEXT,
  is_active       BOOLEAN     DEFAULT true,
  locale          TEXT        DEFAULT 'en',
  avatar_url      TEXT,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- ============================================================
-- parcels
-- ============================================================
CREATE TABLE parcels (
  id                     UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                   TEXT             UNIQUE NOT NULL,
  name                   TEXT             NOT NULL,
  owner_name             TEXT,
  owner_contact          TEXT,
  area_hectares          NUMERIC(10,2),
  boundary               GEOMETRY(Polygon, 4326),
  centroid               GEOMETRY(Point, 4326),
  address                TEXT,
  municipality           TEXT,
  farmtrack_geofence_id  TEXT,
  notes                  TEXT,
  is_active              BOOLEAN          DEFAULT true,
  created_at             TIMESTAMPTZ      DEFAULT now(),
  updated_at             TIMESTAMPTZ      DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

-- ============================================================
-- machines
-- ============================================================
CREATE TABLE machines (
  id                     UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_type           machine_type     NOT NULL,
  registration_plate     TEXT,
  internal_code          TEXT             UNIQUE,
  make                   TEXT,
  model                  TEXT,
  year                   INTEGER,
  fuel_type              fuel_type,
  tank_capacity_liters   NUMERIC(8,2),
  farmtrack_device_id    TEXT,
  current_odometer_km    NUMERIC(12,2)    DEFAULT 0,
  current_hourmeter_hrs  NUMERIC(10,2)    DEFAULT 0,
  is_active              BOOLEAN          DEFAULT true,
  max_payload_kg         NUMERIC(10,2),
  max_bale_count         INTEGER,
  tare_weight_kg         NUMERIC(10,2),
  bales_per_hour_avg     NUMERIC(6,2),
  bale_weight_avg_kg     NUMERIC(8,2),
  reach_meters           NUMERIC(6,2),
  created_at             TIMESTAMPTZ      DEFAULT now(),
  updated_at             TIMESTAMPTZ      DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

-- ============================================================
-- delivery_destinations
-- ============================================================
CREATE TABLE delivery_destinations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            TEXT        UNIQUE NOT NULL,
  name            TEXT        NOT NULL,
  address         TEXT,
  coords          GEOMETRY(Point, 4326),
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
