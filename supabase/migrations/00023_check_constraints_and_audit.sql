-- CHECK constraints to prevent invalid generated column values
DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_weights_positive
    CHECK (gross_weight_kg IS NULL OR gross_weight_kg > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_tare_positive
    CHECK (tare_weight_kg IS NULL OR tare_weight_kg > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_net_weight_sane
    CHECK (gross_weight_kg IS NULL OR tare_weight_kg IS NULL OR gross_weight_kg >= tare_weight_kg);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_odometer_order
    CHECK (arrival_odometer_km IS NULL OR departure_odometer_km IS NULL OR arrival_odometer_km >= departure_odometer_km);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend audit trigger to cover DELETE operations
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, new_values, user_id, created_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW),
            current_setting('app.user_id', true)::uuid, NOW());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, old_values, new_values,
                            changed_fields, user_id, created_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW),
            ARRAY(SELECT key FROM jsonb_each(to_jsonb(NEW))
                  WHERE to_jsonb(NEW) -> key IS DISTINCT FROM to_jsonb(OLD) -> key),
            current_setting('app.user_id', true)::uuid, NOW());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, old_values, user_id, created_at)
    VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD),
            current_setting('app.user_id', true)::uuid, NOW());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Re-create triggers with DELETE support
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['trips', 'bale_loads', 'bale_productions', 'fuel_logs',
    'consumable_logs', 'machines', 'parcels', 'task_assignments', 'users',
    'delivery_destinations', 'documents'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_trigger ON %I', t);
    EXECUTE format('CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()', t);
  END LOOP;
END $$;
