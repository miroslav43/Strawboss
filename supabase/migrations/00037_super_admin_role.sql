-- supabase/migrations/00037_super_admin_role.sql
-- Adds super_admin value to user_role enum.
-- super_admin users bypass all organization filters and have organization_id = NULL.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
