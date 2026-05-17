-- supabase/migrations/00036_organizations.sql
-- Adds multi-tenant organizations table and organization_id to all entity tables.

-- ============================================================
-- 1. organizations table
-- ============================================================
CREATE TABLE organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Seed the default organization for all pre-existing data.
INSERT INTO organizations (id, slug, name)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'strawboss',
  'StrawBoss'
);

-- ============================================================
-- 2. Add organization_id to all entity tables
-- ============================================================
ALTER TABLE users                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE machines             ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE parcels              ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE delivery_destinations ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE farms                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE trips                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE task_assignments     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE bale_loads           ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE bale_productions     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE fuel_logs            ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE consumable_logs      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE documents            ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE alerts               ADD COLUMN organization_id UUID REFERENCES organizations(id);

-- ============================================================
-- 3. Backfill all existing rows to the default organization
-- ============================================================
UPDATE users                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE machines             SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE parcels              SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE delivery_destinations SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE farms                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE trips                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE task_assignments     SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE bale_loads           SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE bale_productions     SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE fuel_logs            SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE consumable_logs      SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE documents            SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE alerts               SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;

-- Make NOT NULL after backfill (users stays nullable for super_admin)
ALTER TABLE machines             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE parcels              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE delivery_destinations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE farms                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE trips                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE task_assignments     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bale_loads           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bale_productions     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE fuel_logs            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE consumable_logs      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE documents            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE alerts               ALTER COLUMN organization_id SET NOT NULL;
-- users.organization_id stays nullable (super_admin users have null)

-- ============================================================
-- 4. Fix unique constraints to be per-org
-- ============================================================
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_code_key;
ALTER TABLE parcels ADD CONSTRAINT parcels_code_org_unique UNIQUE (code, organization_id);

ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_internal_code_key;
ALTER TABLE machines ADD CONSTRAINT machines_internal_code_org_unique UNIQUE (internal_code, organization_id);

ALTER TABLE delivery_destinations DROP CONSTRAINT IF EXISTS delivery_destinations_code_key;
ALTER TABLE delivery_destinations ADD CONSTRAINT delivery_destinations_code_org_unique UNIQUE (code, organization_id);

-- ============================================================
-- 5. Indexes on organization_id for query performance
-- ============================================================
CREATE INDEX idx_users_org_id                ON users (organization_id);
CREATE INDEX idx_machines_org_id             ON machines (organization_id);
CREATE INDEX idx_parcels_org_id              ON parcels (organization_id);
CREATE INDEX idx_delivery_destinations_org_id ON delivery_destinations (organization_id);
CREATE INDEX idx_farms_org_id                ON farms (organization_id);
CREATE INDEX idx_trips_org_id                ON trips (organization_id);
CREATE INDEX idx_task_assignments_org_id     ON task_assignments (organization_id);
CREATE INDEX idx_bale_loads_org_id           ON bale_loads (organization_id);
CREATE INDEX idx_bale_productions_org_id     ON bale_productions (organization_id);
CREATE INDEX idx_fuel_logs_org_id            ON fuel_logs (organization_id);
CREATE INDEX idx_consumable_logs_org_id      ON consumable_logs (organization_id);
CREATE INDEX idx_documents_org_id            ON documents (organization_id);
CREATE INDEX idx_alerts_org_id               ON alerts (organization_id);

-- Grant supabase_auth_admin SELECT on organizations so JWT hook can read slugs.
GRANT SELECT ON public.organizations TO supabase_auth_admin;
