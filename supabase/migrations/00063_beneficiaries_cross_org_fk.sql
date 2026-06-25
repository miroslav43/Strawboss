-- 00063_beneficiaries_cross_org_fk.sql
-- Defense-in-depth: a trip_request may only reference a beneficiary in the SAME org.
-- The application layer already derives org + beneficiary from one JOIN, but the
-- single-column FK (beneficiary_id -> beneficiaries.id) could not catch a cross-org
-- value if a future write path ever took beneficiary_id from untrusted input.

-- 1) Composite unique target on beneficiaries (an FK must reference a unique/PK key).
ALTER TABLE beneficiaries DROP CONSTRAINT IF EXISTS beneficiaries_org_id_key;
ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_org_id_key UNIQUE (organization_id, id);

-- 2) Replace the single-column FK with a composite (organization_id, beneficiary_id) FK.
--    With MATCH SIMPLE (default), rows where beneficiary_id IS NULL are NOT checked, so
--    non-beneficiary trip_requests are unaffected.
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_beneficiary_id_fkey;
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_beneficiary_org_fkey;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_beneficiary_org_fkey
  FOREIGN KEY (organization_id, beneficiary_id)
  REFERENCES beneficiaries (organization_id, id);
