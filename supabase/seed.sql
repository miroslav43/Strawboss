-- seed.sql
-- Sample data for local development.
-- Run with: supabase db reset  (applies migrations then seed)

-- ============================================================
-- Users: 1 admin, 1 dispatcher, 1 driver
-- ============================================================
INSERT INTO users (id, email, full_name, role, phone, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@strawboss.local',      'Ana Admin',       'admin',      '+385911111111', true),
  ('a0000000-0000-0000-0000-000000000002', 'dispatcher@strawboss.local', 'Darko Dispatcher', 'dispatcher', '+385922222222', true),
  ('a0000000-0000-0000-0000-000000000003', 'driver@strawboss.local',     'Dragan Driver',    'driver',     '+385933333333', true);

-- ============================================================
-- Parcels
-- ============================================================
INSERT INTO parcels (id, code, name, owner_name, owner_contact, area_hectares, address, municipality, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'P-2026-001', 'Njiva Istok',   'Ivan Horvat',  '+385991000001', 25.50, 'Ulica polja 1, Osijek',    'Osijek',    true),
  ('b0000000-0000-0000-0000-000000000002', 'P-2026-002', 'Parcela Zapad', 'Marko Kovac',  '+385991000002', 42.00, 'Seoska cesta 14, Vukovar', 'Vukovar',   true),
  ('b0000000-0000-0000-0000-000000000003', 'P-2026-003', 'Veliko Polje',  'Ante Babic',   '+385991000003', 68.75, 'Poljski put 7, Vinkovci',  'Vinkovci',  true);

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
-- Task assignments for today
-- ============================================================
INSERT INTO task_assignments (id, assignment_date, machine_id, parcel_id, assigned_user_id, priority, sequence_order, estimated_start, estimated_end) VALUES
  ('e0000000-0000-0000-0000-000000000001', CURRENT_DATE, 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'normal', 1, CURRENT_DATE + INTERVAL '7 hours', CURRENT_DATE + INTERVAL '9 hours'),
  ('e0000000-0000-0000-0000-000000000002', CURRENT_DATE, 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'high',   2, CURRENT_DATE + INTERVAL '10 hours', CURRENT_DATE + INTERVAL '12 hours');

-- ============================================================
-- Trip in 'planned' status
-- ============================================================
INSERT INTO trips (id, trip_number, status, source_parcel_id, truck_id, driver_id, loader_id, bale_count) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'TR-2026-0001', 'planned', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 0);
