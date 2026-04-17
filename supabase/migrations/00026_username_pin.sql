-- Add username and PIN columns to users table.
-- username: unique login identifier (auto-generated from fullName, editable by admin)
-- pin: 4-digit password alternative (auto-generated, editable by admin, stored plain)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS pin      CHAR(4);
