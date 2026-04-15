-- Enforce UNIQUE (assignment_date, machine_id, sequence_order) only among non-deleted rows.
-- Soft-deleted rows previously kept their sequence_order and blocked live rows from reusing 0..n
-- (e.g. parcel reorder PATCH → 23505).

ALTER TABLE task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_assignment_date_machine_id_sequence_order_key;

CREATE UNIQUE INDEX IF NOT EXISTS task_assignments_date_machine_seq_active_key
  ON task_assignments (assignment_date, machine_id, sequence_order)
  WHERE deleted_at IS NULL;
