-- 00092_cmr_scan_delivery_document_type.sql
-- New document type for the ARRIVAL CMR: the photo the external driver uploads
-- through a one-time public link when the aux load reaches its destination.
-- Distinct from 'cmr_scan', which is the paper CMR the loader photographs at
-- pickup — both now coexist on the same aux trip request (departure + arrival).
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+, but the new
-- label may NOT be referenced by any other statement in that same transaction. So
-- this file contains exactly one statement: no index, no CHECK, no cast, no
-- backfill (same reasoning as 00083 / 00087 / 00088).

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'cmr_scan_delivery';
