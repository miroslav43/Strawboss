-- 00046_users_assigned_delivery_destination.sql
-- Adds a permanent link between a depot_manager user and the delivery_destination
-- they manage. Mirrors users.assigned_machine_id. The org-match check is enforced
-- in the service layer (admin-users.service.ts) so this migration stays idempotent
-- regardless of organization_id column presence.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assigned_delivery_destination_id UUID NULL
  REFERENCES delivery_destinations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_assigned_delivery_destination
  ON users(assigned_delivery_destination_id)
  WHERE assigned_delivery_destination_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN users.assigned_delivery_destination_id IS
  'Depot (delivery_destination) this depot_manager user is assigned to. NULL for other roles.';
