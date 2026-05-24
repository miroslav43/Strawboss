-- ============================================================================
-- 00042 migration test: harvest_status downgrade prevention trigger
--
-- Usage:
--   psql "$DATABASE_URL" -f tests/migrations/00042-test.sql
--
-- Expected output:
--   - "OK upgrade harvesting -> harvested allowed"
--   - "OK no-op same-status allowed"
--   - "OK downgrade blocked harvested -> partial_harvested"
--   - "OK downgrade blocked completed -> harvesting"
--   - "OK bypass GUC allows downgrade"
-- ============================================================================

DO $$
DECLARE
  v_parcel_id UUID;
  v_org_id    UUID;
  v_farm_id   UUID;
  v_caught    BOOLEAN;
BEGIN
  -- Pick an org + farm for the test row
  SELECT id INTO v_org_id FROM organizations WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_farm_id FROM farms WHERE deleted_at IS NULL LIMIT 1;

  -- Insert an isolated test parcel
  INSERT INTO parcels (
    id, organization_id, farm_id, code, name, area_hectares,
    address, municipality, harvest_status
  )
  VALUES (
    gen_random_uuid(),
    v_org_id,
    v_farm_id,
    'TEST-00042-' || (extract(epoch from now())::bigint)::text,
    'Test parcel 00042',
    1.0,
    'Test address',
    'Test municipality',
    'planned'
  )
  RETURNING id INTO v_parcel_id;

  -- 1. forward jump: planned -> harvesting (rank 0 -> 2) — allowed
  UPDATE parcels SET harvest_status = 'harvesting' WHERE id = v_parcel_id;
  RAISE NOTICE 'OK upgrade planned -> harvesting allowed';

  -- 2. forward jump: harvesting -> harvested — allowed
  UPDATE parcels SET harvest_status = 'harvested' WHERE id = v_parcel_id;
  RAISE NOTICE 'OK upgrade harvesting -> harvested allowed';

  -- 3. no-op same status — allowed
  UPDATE parcels SET harvest_status = 'harvested' WHERE id = v_parcel_id;
  RAISE NOTICE 'OK no-op same-status allowed';

  -- 4. downgrade: harvested -> partial_harvested — must be blocked
  v_caught := FALSE;
  BEGIN
    UPDATE parcels SET harvest_status = 'partial_harvested' WHERE id = v_parcel_id;
  EXCEPTION WHEN check_violation THEN
    v_caught := TRUE;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'TEST FAIL: downgrade harvested -> partial_harvested was NOT blocked';
  END IF;
  RAISE NOTICE 'OK downgrade blocked harvested -> partial_harvested';

  -- 5. upgrade further: harvested -> completed
  UPDATE parcels SET harvest_status = 'completed' WHERE id = v_parcel_id;
  RAISE NOTICE 'OK upgrade harvested -> completed allowed';

  -- 6. downgrade: completed -> harvesting — must be blocked
  v_caught := FALSE;
  BEGIN
    UPDATE parcels SET harvest_status = 'harvesting' WHERE id = v_parcel_id;
  EXCEPTION WHEN check_violation THEN
    v_caught := TRUE;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'TEST FAIL: downgrade completed -> harvesting was NOT blocked';
  END IF;
  RAISE NOTICE 'OK downgrade blocked completed -> harvesting';

  -- 7. bypass GUC allows downgrade
  SET LOCAL app.allow_harvest_downgrade = 'on';
  UPDATE parcels SET harvest_status = 'harvesting' WHERE id = v_parcel_id;
  RAISE NOTICE 'OK bypass GUC allows downgrade';
  -- reset
  SET LOCAL app.allow_harvest_downgrade = 'off';

  -- Cleanup
  DELETE FROM parcels WHERE id = v_parcel_id;
  RAISE NOTICE 'Test parcel cleaned up';
END $$;
