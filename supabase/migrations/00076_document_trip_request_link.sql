-- 00076_document_trip_request_link.sql
-- Link an uploaded aviz (aviz de însoțire a mărfii, document_type = 'delivery_note')
-- to a trip_request. Until now `documents` could only reference a trip (documents.trip_id);
-- avize are uploaded against a request that may still be pending (no trip yet).
-- Nullable so the existing CMR path (trip_id set, trip_request_id null) is unchanged.
-- documents is NOT a sync table, so no sync_version. Idempotent.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS trip_request_id UUID REFERENCES trip_requests(id);

-- Partial index: only the small subset of documents that are request-scoped avize.
CREATE INDEX IF NOT EXISTS idx_documents_trip_request_id
  ON documents (trip_request_id)
  WHERE trip_request_id IS NOT NULL;
