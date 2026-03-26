-- 00007_triggers.sql
-- Auto-update timestamps and audit logging triggers.

-- ============================================================
-- set_updated_at() — auto-update updated_at on every UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all mutable tables
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_parcels_updated_at
  BEFORE UPDATE ON parcels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_machines_updated_at
  BEFORE UPDATE ON machines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_delivery_destinations_updated_at
  BEFORE UPDATE ON delivery_destinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_task_assignments_updated_at
  BEFORE UPDATE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bale_loads_updated_at
  BEFORE UPDATE ON bale_loads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bale_productions_updated_at
  BEFORE UPDATE ON bale_productions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fuel_logs_updated_at
  BEFORE UPDATE ON fuel_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_consumable_logs_updated_at
  BEFORE UPDATE ON consumable_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- audit_trigger_func() — generic audit logging
-- SECURITY DEFINER so it can write to audit_logs even when
-- the calling user's RLS would block direct inserts.
-- ============================================================
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old       JSONB;
  v_new       JSONB;
  v_changed   TEXT[];
  v_op        audit_operation;
  v_key       TEXT;
  v_user_id   UUID;
  v_client_id TEXT;
BEGIN
  -- Determine operation
  IF TG_OP = 'INSERT' THEN
    v_op  := 'insert';
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_changed := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_op  := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Compute changed fields
    v_changed := ARRAY(
      SELECT key
      FROM jsonb_each(v_new) AS n(key, value)
      WHERE NOT v_old ? key
         OR v_old->key IS DISTINCT FROM v_new->key
    );
    -- Skip audit if nothing actually changed
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Try to get current user info from JWT claims (safe if not set)
  BEGIN
    v_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Try to get client_id from the record itself (for offline sync)
  IF v_new ? 'client_id' THEN
    v_client_id := v_new->>'client_id';
  END IF;

  INSERT INTO audit_logs (table_name, record_id, operation, old_values, new_values, changed_fields, user_id, client_id)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    v_op,
    v_old,
    v_new,
    v_changed,
    v_user_id,
    v_client_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply audit trigger to critical tables (fires AFTER to capture final values)
CREATE TRIGGER trg_trips_audit
  AFTER INSERT OR UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_bale_loads_audit
  AFTER INSERT OR UPDATE ON bale_loads
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_fuel_logs_audit
  AFTER INSERT OR UPDATE ON fuel_logs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_task_assignments_audit
  AFTER INSERT OR UPDATE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
