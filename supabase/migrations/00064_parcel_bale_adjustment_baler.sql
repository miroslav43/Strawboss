-- 00064_parcel_bale_adjustment_baler.sql
-- Optional attribution: which baler MACHINE produced the bales added via a manual
-- 'produced' override. Nullable; only meaningful for kind='produced' rows.

ALTER TABLE parcel_bale_adjustments
  ADD COLUMN IF NOT EXISTS baler_id UUID REFERENCES machines(id);

CREATE INDEX IF NOT EXISTS idx_parcel_bale_adjustments_baler
  ON parcel_bale_adjustments (baler_id) WHERE deleted_at IS NULL;
