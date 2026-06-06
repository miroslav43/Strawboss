-- 00049_crop_type_altele.sql
-- T9.1 follow-up — add an "altele" (other) value to the parcel crop_type enum so
-- the mobile geofence-maker crop dropdown can offer a catch-all option alongside
-- grau / orz / rapita / plante_nutret.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run.
-- Safe under `psql --single-transaction` (scripts/05-db.sh) on PostgreSQL 12+:
-- a new enum value may be added inside a transaction as long as it is not USED in
-- the same transaction — this migration only adds it.
ALTER TYPE crop_type ADD VALUE IF NOT EXISTS 'altele';
