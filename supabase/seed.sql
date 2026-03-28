-- seed.sql
-- Sample data for local development.
-- Run with: supabase db reset  (applies migrations then seed)

-- ============================================================
-- Users: 1 admin, 1 driver
-- ============================================================
INSERT INTO users (id, email, full_name, role, phone, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@strawboss.local',  'Ana Admin',    'admin',  '+385911111111', true),
  ('a0000000-0000-0000-0000-000000000003', 'driver@strawboss.local', 'Dragan Driver','driver', '+385933333333', true);

-- ============================================================
-- Parcels
-- (none seeded — add real fields via the Map page in the admin dashboard)
-- ============================================================

-- ============================================================
-- Machines: 2 trucks, 1 loader, 1 baler
-- ============================================================
INSERT INTO machines (id, machine_type, registration_plate, internal_code, make, model, year, fuel_type, tank_capacity_liters, current_odometer_km, max_payload_kg, max_bale_count, tare_weight_kg, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'truck',  'OS-1234-AB', 'T-01', 'MAN',     'TGX 26.510',  2022, 'diesel', 400.00, 125000.00, 24000.00, 26, 14500.00, true),
  ('c0000000-0000-0000-0000-000000000002', 'truck',  'VU-5678-CD', 'T-02', 'Mercedes', 'Actros 2545', 2021, 'diesel', 390.00,  98000.00, 22000.00, 24, 13800.00, true),
  ('c0000000-0000-0000-0000-000000000003', 'loader', NULL,         'L-01', 'JCB',     '531-70',       2020, 'diesel', 120.00,  NULL,       NULL,    NULL, NULL,    true),
  ('c0000000-0000-0000-0000-000000000004', 'baler',  NULL,         'B-01', 'Claas',   'Quadrant 5300', 2023, 'diesel', 150.00,  NULL,       NULL,    NULL, NULL,    true);

-- Set loader-specific fields
UPDATE machines SET bales_per_hour_avg = 45.00, reach_meters = 7.00, current_hourmeter_hrs = 2150.00 WHERE internal_code = 'L-01';
-- Set baler-specific fields
UPDATE machines SET bales_per_hour_avg = 60.00, bale_weight_avg_kg = 350.00, current_hourmeter_hrs = 1800.00 WHERE internal_code = 'B-01';

-- ============================================================
-- Delivery destinations
-- ============================================================
INSERT INTO delivery_destinations (id, code, name, address, contact_name, contact_phone, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'DD-001', 'Farma Slavonija d.o.o.',  'Industrijska 22, Osijek',   'Josip Matic',  '+385994000001', true),
  ('d0000000-0000-0000-0000-000000000002', 'DD-002', 'Bio Energija Vukovar',    'Luka bb, Vukovar',          'Petra Novak',  '+385994000002', true);

-- ============================================================
-- Task assignments and trips
-- (none seeded — parcels must exist first; create via the admin dashboard)
-- ============================================================
