-- 00001_extensions_and_enums.sql
-- Enable required extensions and create all enum types.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'loader_operator', 'driver');
CREATE TYPE machine_type AS ENUM ('truck', 'loader', 'baler');
CREATE TYPE fuel_type AS ENUM ('diesel', 'gasoline', 'electric');
CREATE TYPE trip_status AS ENUM (
  'planned', 'loading', 'loaded', 'in_transit', 'arrived',
  'delivering', 'delivered', 'completed', 'cancelled', 'disputed'
);
CREATE TYPE parcel_status AS ENUM ('active', 'inactive');
CREATE TYPE consumable_type AS ENUM ('twine', 'net_wrap', 'silage_film', 'other');
CREATE TYPE document_type AS ENUM ('cmr', 'invoice', 'delivery_note', 'weight_ticket', 'report');
CREATE TYPE document_status AS ENUM ('pending', 'generating', 'generated', 'sent', 'failed');
CREATE TYPE alert_category AS ENUM ('fraud', 'anomaly', 'maintenance', 'safety', 'system');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE audit_operation AS ENUM ('insert', 'update', 'delete');
CREATE TYPE assignment_priority AS ENUM ('low', 'normal', 'high', 'urgent');
