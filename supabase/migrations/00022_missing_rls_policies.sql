-- farms
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_farms ON farms;
CREATE POLICY admin_all_farms ON farms FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
);
DROP POLICY IF EXISTS read_farms ON farms;
CREATE POLICY read_farms ON farms FOR SELECT USING (true);

-- parcel_daily_status
ALTER TABLE parcel_daily_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_pds ON parcel_daily_status;
CREATE POLICY admin_all_pds ON parcel_daily_status FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
);
DROP POLICY IF EXISTS read_all_pds ON parcel_daily_status;
CREATE POLICY read_all_pds ON parcel_daily_status FOR SELECT USING (true);

-- geofence_events
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_ge ON geofence_events;
CREATE POLICY admin_all_ge ON geofence_events FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
);
DROP POLICY IF EXISTS read_own_ge ON geofence_events;
CREATE POLICY read_own_ge ON geofence_events FOR SELECT USING (
  machine_id IN (SELECT assigned_machine_id FROM users WHERE id = public.user_id())
);

-- device_push_tokens
ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_tokens ON device_push_tokens;
CREATE POLICY own_tokens ON device_push_tokens FOR ALL USING (user_id = public.user_id()) WITH CHECK (user_id = public.user_id());
DROP POLICY IF EXISTS admin_tokens ON device_push_tokens;
CREATE POLICY admin_tokens ON device_push_tokens FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = public.user_id() AND role = 'admin')
);

-- Fix driver RLS for 'loaded' status
DROP POLICY IF EXISTS driver_update_trips ON trips;
CREATE POLICY driver_update_trips ON trips FOR UPDATE
  USING (driver_id = public.user_id() AND status IN ('loaded', 'in_transit', 'arrived', 'delivering', 'delivered'))
  WITH CHECK (driver_id = public.user_id());
