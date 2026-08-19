-- 00099_beneficiary_locale.sql
-- Default UI/correspondence language per beneficiary (buyer company).
--
-- Why: beneficiaries.* has never had a locale, so the two email call sites
-- that address a beneficiary directly (TransportConfirmationProcessor,
-- AvizNotificationService) hardcode DEFAULT_LOCALE with a comment explaining
-- there is nothing to read. This column is that missing read. It follows the
-- same precedent as users.locale (see 2026-08-16-hungarian-locale.md, Global
-- constraint 9): TEXT with a hard DEFAULT, no CHECK constraint. The runtime
-- guard is the zod enum built from SUPPORTED_LOCALES, not the database — a
-- CHECK would fail with 23514 -> 500 instead of a clean 400, and would turn
-- every future language into a migration.
--
-- IDEMPOTENCY: scripts/db-migrate re-runs every file on every invocation (no
-- migration tracking table), each in its own `psql --single-transaction`, so
-- this uses ADD COLUMN IF NOT EXISTS and has no down-migration.
--
-- Adding a NOT NULL column with a constant DEFAULT is metadata-only on
-- PG11+ (no table rewrite, no long lock), same reasoning as 00098.
SET lock_timeout = '3s';

ALTER TABLE beneficiaries
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'ro';

COMMENT ON COLUMN beneficiaries.locale IS
  'Default language for server-sent correspondence to this beneficiary '
  '(transport-confirmation and aviz-uploaded emails). TEXT, no CHECK -- '
  'validated by the zod enum built from @strawboss/types SUPPORTED_LOCALES. '
  'Independent from the public request portal''s own LangToggle, which lets '
  'a visitor pick their own display language for that one session.';
