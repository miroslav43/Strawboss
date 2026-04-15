-- Repair task_assignments daily-plan columns. Uses a dedicated enum name so we do not
-- clash with any legacy type named assignment_status (e.g. draft/published/...).

DO $do$
BEGIN
  CREATE TYPE task_assignment_status AS ENUM ('available', 'in_progress', 'done');
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$do$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_assignments'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE task_assignments
      ADD COLUMN status task_assignment_status NOT NULL DEFAULT 'available';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_assignments'
      AND column_name = 'parent_assignment_id'
  ) THEN
    ALTER TABLE task_assignments
      ADD COLUMN parent_assignment_id UUID REFERENCES task_assignments(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_assignments_parent
  ON task_assignments (parent_assignment_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_assignments_status
  ON task_assignments (assignment_date, status)
  WHERE deleted_at IS NULL;

-- If an older 00015 added `status` as type assignment_status (same labels), align with task_assignment_status
DO $$
DECLARE
  udt text;
BEGIN
  SELECT c.udt_name INTO udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'task_assignments'
    AND c.column_name = 'status';
  IF udt = 'assignment_status' THEN
    ALTER TABLE task_assignments
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE task_assignment_status USING status::text::task_assignment_status,
      ALTER COLUMN status SET DEFAULT 'available'::task_assignment_status;
  END IF;
END $$;
