-- Add company ownership fields to machines
ALTER TABLE machines
  ADD COLUMN owner_company_name    TEXT,
  ADD COLUMN owner_company_address TEXT,
  ADD COLUMN owner_company_cui     TEXT;

-- Remove deprecated fields
ALTER TABLE machines
  DROP COLUMN IF EXISTS bales_per_hour_avg,
  DROP COLUMN IF EXISTS reach_meters,
  DROP COLUMN IF EXISTS max_payload_kg;

-- Make registration_plate required (backfill NULLs with empty string first)
UPDATE machines SET registration_plate = '' WHERE registration_plate IS NULL;
ALTER TABLE machines
  ALTER COLUMN registration_plate SET NOT NULL,
  ALTER COLUMN registration_plate SET DEFAULT '';

-- Ensure fuel_type defaults to diesel
ALTER TABLE machines ALTER COLUMN fuel_type SET DEFAULT 'diesel';
