# StrawBoss

Digital logistics platform for straw baling operations. Replaces paper-based workflows with real-time task assignment, trip tracking, CMR document generation, and anti-fraud detection.

## What it does

StrawBoss manages the complete chain of agricultural straw logistics:

1. **Dispatchers** assign machines (trucks, loaders, balers) to parcels via a drag-and-drop board
2. **Loader operators** scan QR codes, load bales, and record counts on their phones (works offline)
3. **Drivers** track trips from loading through delivery — recording odometer readings, weights, photos, and collecting signatures
4. **The system** generates CMR transport documents, detects fraud (odometer/GPS discrepancies, fuel anomalies), and reconciles bale counts across the chain
5. **Admins** see everything in real-time on a dashboard with live status updates, reports, and alerts

---

## Architecture

```
                          ┌─────────────────┐
                          │  Supabase Cloud  │
                          │  ─────────────── │
                          │  PostgreSQL+GIS  │
                          │  Auth (JWT)      │
                          │  Storage         │
                          │  Realtime        │
                          └────────┬────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
     ┌──────┴──────┐       ┌──────┴──────┐       ┌──────┴──────┐
     │ Admin Web   │       │   Backend   │       │  Mobile App │
     │ (Next.js)   │◄─────►│  (NestJS)   │◄─────►│   (Expo)    │
     │  :3000      │       │   :3001     │       │             │
     └─────────────┘       └──────┬──────┘       └─────────────┘
                                  │                     │
                           ┌──────┴──────┐        ┌─────┴─────┐
                           │    Redis    │        │  SQLite   │
                           │  (BullMQ)  │        │ (offline) │
                           └─────────────┘        └───────────┘
```

### Deployment Model

- **Self-hosted**: Backend (NestJS) and admin dashboard (Next.js) run in Docker containers
- **Supabase Cloud**: PostgreSQL with PostGIS, authentication, file storage, and realtime subscriptions
- **Mobile**: Expo app distributed via EAS Build (iOS + Android)

---

## Project Structure

```
strawboss/
├── apps/
│   ├── admin-web/              # Next.js 15 — admin dashboard
│   └── mobile/                 # Expo SDK 52 — field operator app
├── packages/
│   ├── types/                  # @strawboss/types — shared TS types (zero deps)
│   ├── validation/             # @strawboss/validation — Zod schemas
│   ├── domain/                 # @strawboss/domain — business logic + state machine
│   ├── api/                    # @strawboss/api — API client + React Query hooks
│   └── ui-tokens/              # @strawboss/ui-tokens — design system constants
├── backend/
│   └── service/                # NestJS + Fastify — REST API + background jobs
├── supabase/
│   ├── migrations/             # SQL migrations (00001–00008)
│   └── seed.sql                # Development seed data
├── docker-compose.yml          # Production orchestration
├── Dockerfile.backend          # Multi-stage backend build
├── Dockerfile.admin            # Multi-stage admin build
├── strawboss.sh                # Monorepo control script
└── .env.example                # Environment variable template
```

---

## Shared Packages

The monorepo uses **pnpm workspaces** + **Turborepo** for build orchestration. Five shared packages sit between the apps:

### `@strawboss/types`

Zero-dependency package defining all TypeScript interfaces and enums. Every entity in the system has a corresponding type here. Key types:

| Type | Purpose |
|------|---------|
| `User`, `UserRole` | Users with roles: admin, dispatcher, loader_operator, driver |
| `Parcel` | Land parcels where bales are produced/loaded |
| `Machine`, `MachineType` | Trucks, loaders, and balers with type-specific fields |
| `Trip`, `TripStatus` | The core entity — tracks a shipment through its lifecycle |
| `BaleLoad` | Individual loading events (bales loaded onto a trip) |
| `BaleProduction` | Baling session records |
| `FuelLog`, `ConsumableLog` | Cost tracking |
| `Document`, `DocumentType` | CMR documents, invoices, reports |
| `Alert`, `AlertCategory` | Fraud detection and system alerts |
| `TaskAssignment` | Machine-to-parcel assignments per day |
| `AuditLog` | Immutable audit trail |

**Conventions**: All IDs are UUID strings. All dates are ISO 8601 strings. Every mutable entity has `id`, `createdAt`, `updatedAt`, `deletedAt` (soft delete).

DTOs for API requests live in `src/dtos/`: trip creation, trip workflow transitions, sync payloads, and dashboard aggregations.

### `@strawboss/validation`

Zod schemas mirroring every type. Used for runtime validation on both backend (request validation) and frontend (form validation). Provides:

- Full entity schemas for reading/validating complete records
- `create*Schema` variants for creation (no id, no timestamps)
- `update*Schema` variants with all fields optional
- Helper schemas: `uuidSchema`, `isoDateSchema`, `geoPointSchema`

### `@strawboss/domain`

Pure business logic with zero I/O dependencies. Contains:

**Trip State Machine** (XState v5) — The heart of the system. Defines the trip lifecycle:

```
planned ──► loading ──► loaded ──► in_transit ──► arrived ──► delivering ──► delivered ──► completed
   │            │          │           │             │             │             │              │
   └────────────┴──────────┴───────────┴─────────────┴─────────────┴─────────────┘              │
                                     CANCEL (from any except completed)                         │
                                                                              DISPUTE ◄────────┘
                                                                                 │
                                                                          RESOLVE_DISPUTE
```

Each transition has guards (required data validation) and assigns context (timestamps, odometer readings, weights, etc.). The machine is created with `setup().createMachine()` and can be instantiated per-trip with `createTripMachine()`.

**Fraud Detection**:
- `checkOdometerGpsDiscrepancy()` — compares odometer distance vs GPS distance to detect detours or tampering
- `detectFuelAnomaly()` — z-score analysis against historical fuel consumption readings
- `checkTimingAnomaly()` — flags trips that are impossibly fast or suspiciously slow

**Reconciliation**:
- `reconcileBales()` — compares produced vs loaded vs delivered bale counts per parcel, calculates loss percentage
- `reconcileFuel()` — compares actual vs expected fuel consumption with configurable tolerance

**Rules**:
- `validateTaskAssignment()` — prevents double-booking machines or operators
- `checkCmrCompleteness()` — verifies all required fields are present before CMR generation

**Alerts**: `evaluateAlerts()` takes fraud/reconciliation results and produces `AlertDraft` objects with appropriate categories and severity levels.

**Utilities**: Haversine distance calculation between GPS coordinates.

### `@strawboss/api`

The data access layer consumed by both frontends. Contains:

- **Supabase client factory** — creates a configured `@supabase/supabase-js` client
- **Typed API client** — fetch wrapper for backend REST endpoints with JWT injection, error handling, and file upload support
- **Query key factory** — centralized, type-safe query key definitions for TanStack Query cache management
- **43 React Query hooks** covering every entity and operation:
  - Trip CRUD + 8 workflow transition mutations (start-loading through cancel)
  - CRUD hooks for parcels, machines, task assignments, bale loads, fuel logs
  - Document management + CMR generation trigger
  - Alert listing and acknowledgement
  - Dashboard aggregation queries (overview, production, costs, anti-fraud)
  - Auth hooks (session, login, logout)
  - Sync hooks (push, pull, status)

### `@strawboss/ui-tokens`

Design system constants shared between web (Tailwind) and mobile (React Native):

| Token | Values |
|-------|--------|
| Primary | `#0A5C36` (forest green) with 50–900 shade scale |
| Secondary | `#1E8449` |
| Background | `#F3DED8` (warm cream) |
| Surface | `#EED9D2` |
| Danger | `#C62828` |
| Warning | `#B7791F` |
| Spacing | 4px base scale (xs=4 through 5xl=80) |
| Typography | Inter sans-serif, JetBrains Mono monospace |

Exports a **Tailwind CSS preset** (`@strawboss/ui-tokens/tailwind-preset`) and **React Native helpers** (`@strawboss/ui-tokens/native`) including platform-specific shadow styles.

---

## Database

PostgreSQL on Supabase Cloud with PostGIS for geospatial data. The schema is defined across 8 migration files:

| Migration | Contents |
|-----------|----------|
| `00001` | Extensions (uuid-ossp, PostGIS) + 12 enum types |
| `00002` | Core tables: users, parcels (with polygon boundaries), machines, delivery_destinations |
| `00003` | Operations: task_assignments (unique date/machine/sequence), trips (with generated columns for net_weight and odometer_distance), bale_loads, bale_productions |
| `00004` | Support: fuel_logs, consumable_logs, documents, alerts |
| `00005` | Audit: audit_logs (append-only), farmtrack_events, sync_idempotency |
| `00006` | Indexes: B-tree on FKs and filter columns, GiST spatial indexes on parcel boundaries |
| `00007` | Triggers: auto `updated_at` on all 12 mutable tables, audit trigger (SECURITY DEFINER) on trips/bale_loads/fuel_logs/task_assignments |
| `00008` | RLS policies: role-based access for admin, dispatcher, loader_operator, driver |

### Key Design Decisions

- **Soft deletes** (`deleted_at` column) on all mutable entities — nothing is ever physically deleted
- **Generated columns**: `net_weight_kg` = gross - tare, `odometer_distance_km` = arrival - departure (computed by PostgreSQL)
- **JSONB for flexibility**: `fraud_flags` on trips, `payload` on farmtrack events, `metadata` on documents
- **Sync support**: `sync_version` (bigint) on trips, bale_loads, fuel_logs for delta sync. `sync_idempotency` table prevents duplicate offline mutations
- **Audit trail**: Every INSERT/UPDATE on critical tables is automatically logged with old values, new values, changed fields, and user ID

### Row Level Security

| Role | Access |
|------|--------|
| admin | Full CRUD on everything |
| dispatcher | CRUD task_assignments, read all, update trip status |
| loader_operator | Read parcels/machines/own assignments, CRUD own bale_loads/fuel_logs, update loading-phase trips |
| driver | Read parcels/machines/own assignments, update own transit/delivery trips, CRUD own fuel_logs |

Auth functions `auth.user_role()` and `auth.user_id()` extract the role and user ID from Supabase JWT claims.

---

## Backend Service

NestJS application on the Fastify adapter. All endpoints are under `/api/v1/`.

### Module Map

```
AppModule
├── ConfigModule          Zod-validated environment variables
├── DatabaseModule        Drizzle ORM + postgres.js connection
├── AuthModule            Supabase JWT verification + role-based guards
├── ParcelsModule         CRUD /parcels
├── MachinesModule        CRUD /machines
├── TaskAssignmentsModule CRUD + board view + bulk create /task-assignments
├── TripsModule           CRUD + 10 workflow transitions /trips
├── BaleLoadsModule       CRUD /bale-loads
├── FuelLogsModule        CRUD /fuel-logs
├── ConsumableLogsModule  CRUD /consumable-logs
├── DocumentsModule       CRUD + CMR generation /documents
├── AlertsModule          CRUD + acknowledge /alerts
├── AuditModule           Audit log queries + auto-logging interceptor
├── SyncModule            Offline sync: push/pull/status /sync
├── FarmTrackModule       Telemetry integration (stub) + webhook
├── ReconciliationModule  Bale/fuel reconciliation
├── DashboardModule       Aggregation queries /dashboard
├── JobsModule            BullMQ queue registration
└── TrpcModule            tRPC router (health check scaffold)
```

### Trip Workflow Endpoints

The trip is the core domain entity. These endpoints enforce the state machine transitions:

```
POST /trips/:id/start-loading      → planned → loading
POST /trips/:id/complete-loading   → loading → loaded
POST /trips/:id/depart             → loaded → in_transit
POST /trips/:id/arrive             → in_transit → arrived
POST /trips/:id/start-delivery     → arrived → delivering
POST /trips/:id/confirm-delivery   → delivering → delivered
POST /trips/:id/complete           → delivered → completed
POST /trips/:id/cancel             → any (except completed) → cancelled
POST /trips/:id/dispute            → delivered/completed → disputed
POST /trips/:id/resolve-dispute    → disputed → delivered/completed
```

Each endpoint validates the transition is legal using `getAvailableTransitions()` from `@strawboss/domain`, applies the DTO via Zod validation, and updates the trip record with appropriate timestamps and computed values.

### Background Jobs (BullMQ + Redis)

| Queue | Schedule | Purpose |
|-------|----------|---------|
| `alert-evaluation` | Every 15 min | Run fraud detection on recent trips |
| `reconciliation` | Every hour | Bale/fuel reconciliation across parcels and machines |
| `cmr-generation` | On-demand | Async PDF generation on trip completion |
| `farmtrack-sync` | Every 5 min | Pull telemetry (when real API available) |
| `sync-cleanup` | Daily 02:00 | Purge old idempotency keys |

### Auth

JWT tokens are issued by Supabase Auth. The backend verifies them using `jose` (HMAC HS256 with `SUPABASE_JWT_SECRET`). The `@Roles()` decorator enforces role-based access:

```typescript
@Post()
@Roles('admin', 'dispatcher')
create(@Body(new ZodValidationPipe(tripCreateDtoSchema)) dto: TripCreateDto) { ... }
```

The `@CurrentUser()` decorator extracts the authenticated user from the request.

### FarmTrack Integration

An abstract `IFarmTrackService` interface defines the telemetry API:

```typescript
interface IFarmTrackService {
  getVehiclePosition(deviceId: string): Promise<GeoPoint | null>;
  getOdometerReading(deviceId: string): Promise<number | null>;
  getTripTrack(deviceId: string, start: Date, end: Date): Promise<GeoPoint[]>;
  getGeofenceEvents(since: Date): Promise<FarmTrackEvent[]>;
}
```

A `StubFarmTrackService` returns mock data for development. When the real FarmTrack API becomes available, implement `RealFarmTrackService` with the same interface — no other code changes needed.

---

## Admin Dashboard

Next.js 15 with App Router. Styled with Tailwind CSS v4 using the `@strawboss/ui-tokens` preset.

### Pages

| Route | Purpose |
|-------|---------|
| `/login` | Email/password authentication via Supabase |
| `/operations` | Real-time grid of active trips with status badges and progress indicators |
| `/tasks` | Drag-and-drop Kanban board — columns are parcels, cards are machines. Drag to assign. |
| `/trips` | Filterable trip list (status, date range, search). Click through to trip detail with full timeline. |
| `/trips/[tripId]` | Trip detail: timeline, bale loads, weight/delivery info, documents |
| `/documents` | Document list with type filter. Click through to detail with inline PDF viewer. |
| `/reports` | Production reports (produced vs loaded vs delivered per parcel) and cost breakdowns |
| `/alerts` | Alert center with category/severity filters and acknowledge buttons |
| `/settings` | Profile, notification preferences, system settings |

### Real-Time Updates

The `RealtimeProvider` subscribes to Supabase Realtime channels for `trips`, `task_assignments`, and `alerts`. On any postgres change event, it automatically invalidates the matching TanStack Query cache — so the UI stays current without polling.

### Task Board (Drag-and-Drop)

Built with `@dnd-kit/react`. The board shows:
- An "Unassigned" column on the left with available machines
- One column per parcel
- Machines as draggable cards showing internal code, type, and registration plate
- Dropping a machine on a parcel column creates a task assignment via an optimistic mutation

### Charts

Production and cost reports use pure Tailwind-styled horizontal bar charts (no external charting library). Each bar represents a parcel or machine with proportional width and color-coded segments.

---

## Mobile App

Expo SDK 52 with Expo Router (file-based routing). Designed for field operators wearing gloves — large touch targets (56px buttons, 64px numpad keys, 80px action cards).

### Screens

| Tab | Purpose |
|-----|---------|
| Home | Active operation summary, pending sync count, last sync time |
| Scan | QR code scanner via `expo-camera` CameraView |
| Trips | List of trips assigned to current user |
| Sync | Sync status, retry failed entries, conflict resolution |

### Loading Flow

1. Tap "Start Loading" on assigned trip
2. Scan machine QR code (validates against assignment)
3. Enter bale count via NumericPad
4. Review summary, confirm
5. Written to local SQLite + sync queue

### Delivery Flow

1. Tap "Start Delivery" on active trip
2. Enter gross weight via NumericPad (decimal support)
3. Take photo of weight ticket via camera
4. Collect 3 signatures sequentially: driver, receiver, witness
5. Written to local SQLite + sync queue

### Offline-First Architecture

The mobile app works entirely offline. All data is stored locally in SQLite and synced when connectivity is available.

**Local Tables**:
- `operations` — loading/delivery events with all captured data
- `trips` — local copy of assigned trips
- `sync_queue` — outbox for pending mutations

**Sync Flow**:
```
Local Write ──► SQLite + sync_queue
                      │
              ┌───────┴───────┐
              │  Online?       │
              │  YES           │  NO
              ▼               ▼
         Push mutations    Queue for later
         Upload photos     OfflineBanner shown
         Pull updates
         Update local DB
```

1. **All writes** go to local SQLite AND the sync queue simultaneously
2. **Push**: Upload binary files (photos, signatures) first, replace local URIs with server URLs, then push structured data via `POST /api/v1/sync/push`
3. **Pull**: Request delta via `POST /api/v1/sync/pull` with last `sync_version` per table
4. **Triggers**: App foreground, network reconnect, after local write (2s debounce), periodic 60s
5. **Conflict resolution**: Field-level last-write-wins. Server always wins for `status`, `bale_count`, `sync_version`. Critical conflicts shown to user via dialog.
6. **Retry**: Exponential backoff `min(30s * 2^retry, 5min)` with jitter. Max 10 retries.

**Idempotency**: Every sync queue entry has a UUID idempotency key. The server's `sync_idempotency` table prevents duplicate processing even if the same mutation is pushed multiple times.

---

## Docker Deployment

### Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 2. Build and start
./strawboss.sh docker:build
./strawboss.sh docker:up

# Services:
#   Admin dashboard:  http://localhost:3000
#   Backend API:      http://localhost:3001/api/v1
#   Redis:            localhost:6379
```

### Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `backend` | Multi-stage Node 22 Alpine | 3001 | NestJS API server |
| `admin` | Multi-stage Node 22 Alpine | 3000 | Next.js standalone server |
| `redis` | redis:7-alpine | 6379 | BullMQ job queues + caching |

Both application Dockerfiles use multi-stage builds:
1. **deps** stage: install pnpm dependencies with frozen lockfile
2. **builder** stage: copy source, build shared packages in dependency order, then build the app
3. **runner** stage: minimal production image with only built artifacts

Supabase Cloud handles PostgreSQL, authentication, file storage, and realtime — no database container needed.

### Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | Backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Service role key (full access) |
| `SUPABASE_JWT_SECRET` | Backend | JWT verification secret |
| `DATABASE_URL` | Backend | Direct PostgreSQL connection string |
| `REDIS_URL` | Backend | Redis connection (auto-set in Docker) |
| `NEXT_PUBLIC_SUPABASE_URL` | Admin | Supabase project URL (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Admin | Anonymous key (client-side, RLS enforced) |

---

## Control Script

The `strawboss.sh` script provides a single interface for all monorepo operations:

```bash
./strawboss.sh help          # Show all commands

# Setup
./strawboss.sh install       # pnpm install
./strawboss.sh status        # Show build status of all packages

# Development
./strawboss.sh dev           # Start backend + admin
./strawboss.sh dev backend   # Start only backend
./strawboss.sh dev admin     # Start only admin dashboard
./strawboss.sh dev mobile    # Start Expo dev server
./strawboss.sh build         # Build everything
./strawboss.sh build backend # Build only backend + its deps
./strawboss.sh typecheck     # Typecheck all packages
./strawboss.sh lint          # Lint all packages
./strawboss.sh clean         # Remove build artifacts

# Database
./strawboss.sh db:migrate    # Apply SQL migrations
./strawboss.sh db:seed       # Run seed data
./strawboss.sh db:reset      # Migrate + seed

# Docker
./strawboss.sh docker:build  # Build images
./strawboss.sh docker:up     # Start services
./strawboss.sh docker:down   # Stop services
./strawboss.sh docker:logs   # Tail logs
```

---

## Getting Started (Development)

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+ (via corepack: `corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** and Docker Compose (for production deployment)
- **Supabase** project (cloud or local via `supabase start`)
- **psql** (for running migrations directly)

### Setup

```bash
# Clone and install
git clone <repo-url> strawboss
cd strawboss
./strawboss.sh install

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Apply database migrations
./strawboss.sh db:migrate
./strawboss.sh db:seed

# Build shared packages
./strawboss.sh build packages

# Start development
./strawboss.sh dev
```

The admin dashboard will be at `http://localhost:3000` and the backend API at `http://localhost:3001/api/v1`.

### Seed Data

The seed file creates:
- 3 users: admin (`admin@strawboss.local`), dispatcher, driver
- 3 parcels: P-2026-001, P-2026-002, P-2026-003
- 4 machines: T-01, T-02 (trucks), L-01 (loader), B-01 (baler)
- 2 delivery destinations
- 2 task assignments
- 1 trip in "planned" status

---

## Tech Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| **Monorepo** | pnpm workspaces + Turborepo | pnpm 10, turbo 2 |
| **Language** | TypeScript (strict mode) | 5.7+ |
| **Backend** | NestJS + Fastify | NestJS 11, Fastify 5 |
| **ORM** | Drizzle ORM + postgres.js | 0.38+ |
| **Jobs** | BullMQ + Redis | BullMQ 5, Redis 7 |
| **Auth** | Supabase Auth + JWT (jose) | |
| **Database** | PostgreSQL + PostGIS | via Supabase |
| **Admin Web** | Next.js 15 (App Router) | |
| **Styling** | Tailwind CSS v4 | |
| **Components** | Custom + Radix-based | |
| **Drag & Drop** | @dnd-kit/react | |
| **Data Fetching** | TanStack Query v5 | |
| **Realtime** | Supabase Realtime | |
| **Validation** | Zod | 3.23+ |
| **State Machine** | XState v5 | 5.19+ |
| **Mobile** | Expo SDK 52 + Expo Router | |
| **Local Storage** | expo-sqlite | |
| **Mobile State** | Zustand + TanStack Query | |
| **Camera/QR** | expo-camera | |
| **Signatures** | react-native-signature-canvas | |
| **Containers** | Docker + Docker Compose | |
