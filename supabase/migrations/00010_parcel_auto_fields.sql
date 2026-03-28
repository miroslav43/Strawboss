-- 00010_parcel_auto_fields.sql
-- Make parcels.name nullable (set later via Edit modal)
-- and add an auto-incrementing sequence for generating readable parcel codes.

-- Allow name to be null; the UI shows 'Câmp fără nume' as a fallback.
ALTER TABLE parcels ALTER COLUMN name DROP NOT NULL;

-- Sequence for readable auto-generated codes: P-0001, P-0042, etc.
CREATE SEQUENCE IF NOT EXISTS parcels_code_seq START 1;
