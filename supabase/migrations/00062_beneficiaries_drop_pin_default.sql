-- Remove the weak SQL random() default from daily_pin.
-- The application layer (Node crypto.randomInt) always supplies this value on INSERT.
-- Dropping the DEFAULT makes accidental bare INSERTs fail loudly instead of silently
-- seeding a non-CSPRNG value.
ALTER TABLE beneficiaries ALTER COLUMN daily_pin DROP DEFAULT;
