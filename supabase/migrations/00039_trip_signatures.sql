ALTER TABLE trips ADD COLUMN IF NOT EXISTS loader_signature_url TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_signature_url TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS deteriorated_bales_count INTEGER;

ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'partial' AFTER 'generating';
