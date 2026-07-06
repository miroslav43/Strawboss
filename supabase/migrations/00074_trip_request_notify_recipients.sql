-- 00074_trip_request_notify_recipients.sql
-- The beneficiary request portal now lets the coordinator pick up to 10 saved
-- contacts to notify (email + SMS) on confirmation, instead of exactly one. We
-- store a denormalized snapshot of the selected contacts here — same rationale
-- as the flat requester_* / transporter_* columns on this table: the value
-- stored at submit time is the source of truth, so a later edit/delete of a
-- beneficiary_contacts row never changes who an already-submitted request
-- notifies. Shape: [{ "name": text, "phone": text|null, "email": text|null }].
-- Empty ('[]') for legacy rows and the non-beneficiary public portal.
-- Idempotent.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS notify_recipients JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Defense-in-depth: must be a JSON array, capped at 10 (matches the Zod
-- contactIds.max(10) on createBeneficiaryRequestSchema). Re-create so re-running
-- stays clean.
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_notify_recipients_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_notify_recipients_check
  CHECK (
    jsonb_typeof(notify_recipients) = 'array'
    AND jsonb_array_length(notify_recipients) <= 10
  );
