-- Migration 00014: Farms table + farm_id on parcels
-- Farms group parcels (fields) into logical farm units.

CREATE TABLE farms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE parcels
  ADD COLUMN farm_id UUID REFERENCES farms(id) ON DELETE SET NULL;

CREATE INDEX idx_parcels_farm_id ON parcels (farm_id);
