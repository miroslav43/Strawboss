-- 00011_user_machine_assignment.sql
-- Add a direct machine assignment to each user row.
-- A loader_operator is assigned a loader, baler_operator a baler, driver a truck.
-- Constraint enforcement is handled at the application layer; the DB stores the FK.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assigned_machine_id UUID
    REFERENCES machines(id) ON DELETE SET NULL;
