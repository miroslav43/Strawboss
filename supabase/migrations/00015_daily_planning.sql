-- Daily Planning: assignment status, hierarchy, and parcel daily completion tracking

-- Kanban status for task_assignments (name avoids legacy assignment_status enums)
CREATE TYPE task_assignment_status AS ENUM ('available', 'in_progress', 'done');

-- Extend task_assignments with status and parent reference for hierarchy
ALTER TABLE task_assignments
  ADD COLUMN status task_assignment_status NOT NULL DEFAULT 'available',
  ADD COLUMN parent_assignment_id UUID REFERENCES task_assignments(id);

-- parcel_id nullable: loaders/trucks inherit parcel from parent chain
ALTER TABLE task_assignments ALTER COLUMN parcel_id DROP NOT NULL;

-- assigned_user_id nullable: may not be known at planning time
ALTER TABLE task_assignments ALTER COLUMN assigned_user_id DROP NOT NULL;

-- Index for hierarchical queries (parent lookups)
CREATE INDEX idx_task_assignments_parent
  ON task_assignments (parent_assignment_id)
  WHERE deleted_at IS NULL;

-- Index for status-based board queries
CREATE INDEX idx_task_assignments_status
  ON task_assignments (assignment_date, status)
  WHERE deleted_at IS NULL;

-- Parcel daily completion tracking
CREATE TABLE parcel_daily_status (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   UUID        NOT NULL REFERENCES parcels(id),
  status_date DATE        NOT NULL,
  is_done     BOOLEAN     NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, status_date)
);

-- Index for date-based lookups
CREATE INDEX idx_parcel_daily_status_date
  ON parcel_daily_status (status_date);
