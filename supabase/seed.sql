-- seed.sql
-- Sample data for local development.
-- Run with: supabase db reset  (applies migrations then seed)

-- ============================================================
-- Users: admin, loader, driver, baler — keep IDs in sync with scripts/_lib.sh::SEED_*
-- ============================================================
INSERT INTO users (id, email, full_name, role, phone, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@strawboss.local',  'Ana Admin',    'admin',           '+385911111111', true),
  ('a0000000-0000-0000-0000-000000000002', 'loader@strawboss.local', 'Luka Loader',  'loader_operator', '+385922222222', true),
  ('a0000000-0000-0000-0000-000000000003', 'driver@strawboss.local', 'Dragan Driver','driver',          '+385933333333', true),
  ('a0000000-0000-0000-0000-000000000004', 'baler@strawboss.local',  'Borut Baler',  'baler_operator',  '+385944444444', true)
ON CONFLICT (id) DO UPDATE SET
  email     = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role      = EXCLUDED.role,
  phone     = EXCLUDED.phone,
  is_active = EXCLUDED.is_active;

-- ============================================================
-- Machines: 2 trucks, 1 loader, 1 baler
-- ============================================================
INSERT INTO machines (id, machine_type, registration_plate, internal_code, make, model, year, fuel_type, tank_capacity_liters, current_odometer_km, max_payload_kg, max_bale_count, tare_weight_kg, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'truck',  'OS-1234-AB', 'T-01', 'MAN',     'TGX 26.510',  2022, 'diesel', 400.00, 125000.00, 24000.00, 26, 14500.00, true),
  ('c0000000-0000-0000-0000-000000000002', 'truck',  'VU-5678-CD', 'T-02', 'Mercedes', 'Actros 2545', 2021, 'diesel', 390.00,  98000.00, 22000.00, 24, 13800.00, true),
  ('c0000000-0000-0000-0000-000000000003', 'loader', NULL,         'L-01', 'JCB',     '531-70',       2020, 'diesel', 120.00,  NULL,       NULL,    NULL, NULL,    true),
  ('c0000000-0000-0000-0000-000000000004', 'baler',  NULL,         'B-01', 'Claas',   'Quadrant 5300', 2023, 'diesel', 150.00,  NULL,       NULL,    NULL, NULL,    true)
ON CONFLICT (id) DO NOTHING;

-- Set loader-specific fields
UPDATE machines SET bales_per_hour_avg = 45.00, reach_meters = 7.00, current_hourmeter_hrs = 2150.00 WHERE internal_code = 'L-01';
-- Set baler-specific fields
UPDATE machines SET bales_per_hour_avg = 60.00, bale_weight_avg_kg = 350.00, current_hourmeter_hrs = 1800.00 WHERE internal_code = 'B-01';

-- Bind users to their permanent machines (driver→truck, loader→loader, baler→baler)
UPDATE users SET assigned_machine_id = 'c0000000-0000-0000-0000-000000000001' WHERE id = 'a0000000-0000-0000-0000-000000000003';
UPDATE users SET assigned_machine_id = 'c0000000-0000-0000-0000-000000000003' WHERE id = 'a0000000-0000-0000-0000-000000000002';
UPDATE users SET assigned_machine_id = 'c0000000-0000-0000-0000-000000000004' WHERE id = 'a0000000-0000-0000-0000-000000000004';

-- ============================================================
-- Parcels: 1 demo parcel near Osijek with a small (~100m × 100m) boundary
-- so geofence enter/exit logic has something to fire against.
-- ============================================================
INSERT INTO parcels (id, code, name, area_hectares, boundary, centroid, address, municipality, is_active) VALUES
  (
    'e0000000-0000-0000-0000-000000000001',
    'P-001',
    'Câmpul Demo Osijek',
    1.00,
    ST_GeomFromText('POLYGON((18.6948 45.5546, 18.6958 45.5546, 18.6958 45.5554, 18.6948 45.5554, 18.6948 45.5546))', 4326),
    ST_GeomFromText('POINT(18.6953 45.5550)', 4326),
    'Câmp test, Osijek',
    'Osijek',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  boundary    = EXCLUDED.boundary,
  centroid    = EXCLUDED.centroid,
  is_active   = true;

-- ============================================================
-- Delivery destinations
-- ============================================================
INSERT INTO delivery_destinations (id, code, name, address, contact_name, contact_phone, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'DD-001', 'Farma Slavonija d.o.o.',  'Industrijska 22, Osijek',   'Josip Matic',  '+385994000001', true),
  ('d0000000-0000-0000-0000-000000000002', 'DD-002', 'Bio Energija Vukovar',    'Luka bb, Vukovar',          'Petra Novak',  '+385994000002', true)
ON CONFLICT (id) DO NOTHING;

-- Add a small (~100m × 100m) boundary + coords on the default deposit so
-- geofence entry events fire when the truck "arrives" at the warehouse.
UPDATE delivery_destinations
SET
  boundary = ST_GeomFromText('POLYGON((18.6995 45.5446, 18.7005 45.5446, 18.7005 45.5454, 18.6995 45.5454, 18.6995 45.5446))', 4326),
  coords   = ST_GeomFromText('POINT(18.7000 45.5450)', 4326)
WHERE id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================
-- Task assignments for CURRENT_DATE — wire driver+truck and loader+loader
-- to the demo parcel so mock:e2e-trip and the geofence loader notification
-- have a real assignment to attach to. Deterministic IDs so reseeding is safe.
-- ============================================================

-- Loader task: loader_operator on loader machine working the demo parcel.
INSERT INTO task_assignments (
  id, assignment_date, machine_id, parcel_id, assigned_user_id,
  sequence_order, status, priority
) VALUES (
  '11111111-1111-1111-1111-000000000001',
  CURRENT_DATE,
  'c0000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  0,
  'available',
  'normal'
)
ON CONFLICT (id) DO UPDATE SET
  assignment_date = EXCLUDED.assignment_date,
  machine_id      = EXCLUDED.machine_id,
  parcel_id       = EXCLUDED.parcel_id,
  assigned_user_id= EXCLUDED.assigned_user_id,
  status          = 'available',
  deleted_at      = NULL;

-- Truck task: driver on truck T-01 going from demo parcel → default deposit.
-- parent_assignment_id links to the loader task so trips auto-create works.
INSERT INTO task_assignments (
  id, assignment_date, machine_id, parcel_id, assigned_user_id,
  destination_id, parent_assignment_id, sequence_order, status, priority
) VALUES (
  '11111111-1111-1111-1111-000000000002',
  CURRENT_DATE,
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000003',
  'd0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-000000000001',
  0,
  'available',
  'normal'
)
ON CONFLICT (id) DO UPDATE SET
  assignment_date     = EXCLUDED.assignment_date,
  machine_id          = EXCLUDED.machine_id,
  parcel_id           = EXCLUDED.parcel_id,
  assigned_user_id    = EXCLUDED.assigned_user_id,
  destination_id      = EXCLUDED.destination_id,
  parent_assignment_id= EXCLUDED.parent_assignment_id,
  status              = 'available',
  deleted_at          = NULL;
