CREATE TYPE farm_entity_type AS ENUM ('persoana_juridica', 'persoana_fizica');

ALTER TABLE farms ADD COLUMN entity_type farm_entity_type;
ALTER TABLE farms ADD COLUMN cui TEXT;
ALTER TABLE farms ADD COLUMN apia_code TEXT;
