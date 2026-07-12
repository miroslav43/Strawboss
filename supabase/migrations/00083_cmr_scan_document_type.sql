-- 00083_cmr_scan_document_type.sql
-- New document type for the *physical* CMR: the paper transport document the
-- external driver brings, photographed by the loader at the end of an auxiliary
-- load and stored as a PDF. Distinct from 'cmr', which is the CMR the backend
-- generates itself (Puppeteer, stage 1/2) — both now coexist on the same trip.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+, but the new
-- label may NOT be referenced by any other statement in that same transaction. So
-- this file contains exactly one statement: no index, no CHECK, no cast, no backfill.
-- (An index would be redundant anyway — idx_documents_trip_request_id from 00076
-- already covers the request-scoped lookups this type is read by.)

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'cmr_scan';
