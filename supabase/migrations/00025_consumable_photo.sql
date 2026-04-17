-- Adds receipt-photo support to consumable_logs so the mobile app can upload
-- a photo of the fiscal receipt alongside the twine/consumable entry.
-- Mirrors fuel_logs.receipt_photo_url which has existed since the core tables
-- migration. The URL is a public path served by the backend (/api/v1/uploads/...).

ALTER TABLE consumable_logs
  ADD COLUMN IF NOT EXISTS receipt_photo_url TEXT;
