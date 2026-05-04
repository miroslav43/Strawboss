-- 00030_default_delivery_destination.sql
-- Add a global default flag to delivery_destinations so the loader's atomic
-- "register-load" endpoint can derive a destination when neither the truck
-- task nor a previous trip provides one.
-- A partial unique index ensures at most one active row is marked default.

ALTER TABLE delivery_destinations
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_destinations_default_unique
  ON delivery_destinations ((is_default))
  WHERE is_default = TRUE AND deleted_at IS NULL;
