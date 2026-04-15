-- Harvest / field-work phase for parcels (distinct from is_active).

CREATE TYPE harvest_status AS ENUM ('planned', 'to_harvest', 'harvesting', 'harvested');

ALTER TABLE parcels
  ADD COLUMN harvest_status harvest_status NOT NULL DEFAULT 'planned';
