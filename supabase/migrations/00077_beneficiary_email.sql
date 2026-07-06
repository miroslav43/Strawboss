-- Add an email address to beneficiaries (buyer companies).
-- Used as a transport-confirmation recipient: when a beneficiary's trip request is
-- confirmed, the TransportConfirmationProcessor fans the confirmation email out to
-- this address (in addition to the driver and any selected portal contacts).
--
-- Nullable so pre-existing rows stay valid; the admin form requires it for new/edited
-- beneficiaries. No sync_version (beneficiaries are admin-web only, not mobile-synced);
-- the column inherits the table's existing RLS policies.

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS email TEXT;
