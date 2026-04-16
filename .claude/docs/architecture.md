# StrawBoss — System Architecture

## Overview

StrawBoss is a farm operations management platform that tracks straw bale production, loading, transportation, and delivery across a fleet of agricultural machines (balers, loaders, trucks). It consists of a monorepo with 5 shared packages, a NestJS backend, a Next.js admin dashboard, and an Expo mobile app.

## Monorepo Structure

```
Strawboss/
├── packages/
│   ├── types/           Zero-dep TypeScript interfaces and enums
│   ├── validation/      Zod schemas mirroring every type
│   ├── ui-tokens/       Design tokens (colors, spacing, typography)
│   ├── domain/          Pure business logic (XState trip machine, fraud detection)
│   └── api/             TanStack Query hooks, ApiClient, Supabase client factory
├── backend/service/     NestJS 11 + Fastify 5 API server
├── apps/
│   ├── admin-web/       Next.js 15 App Router dashboard
│   └── mobile/          Expo SDK 54 + React Native mobile app
├── supabase/migrations/ PostgreSQL schema (24 migration files)
├── scripts/             Modular shell scripts for strawboss.sh
├── nginx/               Reverse proxy config
├── docker-compose.yml   Production orchestration
└── strawboss.sh         CLI orchestrator (sources scripts/*.sh)
```

## Dependency Graph & Build Order

```
types ─────────────┬──→ validation ──┬──→ api ──────→ admin-web
                   │                 │               → mobile
                   ├──→ ui-tokens ───┘
                   ├──→ domain ──────────→ backend
                   └─────────────────────→ backend
```

**Build order**: `types → validation → ui-tokens → domain → api → backend / admin-web / mobile`

Enforced by Turbo (`turbo.json`: `"dependsOn": ["^build"]`).

## Data Flow

### Write Path (Mobile → Server)

```
Mobile Device
  │
  ├─ Direct API calls ──→ POST /api/v1/trips/:id/depart ──→ NestJS ──→ PostgreSQL
  │   (trip transitions)   (AuthGuard + @Roles + optimistic lock)
  │
  └─ Offline writes ──→ SQLite sync_queue ──→ POST /api/v1/sync/push ──→ PostgreSQL
      (bale productions,    (outbox pattern)   (column allowlist +        (sync_version
       fuel logs, etc.)                         idempotency check)         incremented)
```

### Read Path (Server → Clients)

```
PostgreSQL
  │
  ├─ REST API ──→ NestJS endpoints ──→ TanStack Query cache ──→ Admin-web / Mobile
  │
  └─ Supabase Realtime ──→ WebSocket ──→ Admin-web RealtimeProvider
      (postgres_changes)                  (invalidates query cache)
```

### Sync Path (Bidirectional)

```
Mobile SQLite                                    PostgreSQL
     │                                                │
     ├── push() ──→ POST /sync/push ──→              │
     │   (sync_queue entries                          │
     │    with idempotency_key) ──→ sync_idempotency  │
     │                                                │
     └── pull() ←── POST /sync/pull ←──              │
         (delta by sync_version)                      │
```

See [Sync Protocol](sync-protocol.md) for full details.

## Trip Lifecycle

The trip is the core domain entity. Its lifecycle is enforced by XState v5 in `@strawboss/domain`:

```
planned → loading → loaded → in_transit → arrived → delivering → delivered → completed
                                                                     ↕
                                                                  disputed
```

Each transition has a dedicated REST endpoint with:
- **Auth guard** (global APP_GUARD)
- **Role guard** (@Roles per endpoint)
- **State machine validation** (getAvailableTransitions)
- **Optimistic lock** (WHERE status = $expectedStatus)
- **Audit logging** (Winston flow + DB audit trigger)

At `completed` status: **CMR document auto-generated** via BullMQ job (Puppeteer + Handlebars → PDF).

See [Backend](backend.md) for endpoint details, [Domain](packages-domain.md) for state machine.

## Authentication & Authorization

```
Supabase Auth (JWT issuer)
     │
     ▼
Mobile/Admin-web ──→ Bearer token ──→ NestJS AuthGuard (global APP_GUARD)
                                        │
                                        ├── HS256 verify (SUPABASE_JWT_SECRET)
                                        └── ES256/RS256 verify (JWKS)
                                              │
                                              ▼
                                        RolesGuard (global APP_GUARD)
                                              │
                                              ├── @Public() → skip auth
                                              ├── No @Roles() → any authenticated user
                                              └── @Roles('admin', 'driver') → role check
```

**Roles**: `admin`, `dispatcher`, `baler_operator`, `loader_operator`, `driver`

**Mobile role-based routing**: Auth gate in `_layout.tsx` redirects to role-specific tab layout after login.

## Geofence Detection

Server-side polling (every 5 minutes via BullMQ):

```
GeofenceService.checkMachinePositions()
  │
  ├── Fetch active task_assignments for today (status: available/in_progress)
  ├── Fetch latest GPS per machine (machine_location_events, last 10 min)
  │
  └── For each assignment:
        ├── ST_Contains(boundary, machine_point) → isInside?
        ├── Compare with last geofence_events → detect transition
        │
        ├── ENTER: Record event, set assignment → in_progress
        │          Send push: "Ai intrat pe câmp" (field_entry)
        │
        └── EXIT:  Record event
                   Send push: "Confirmare recoltare" (geofence_exit_confirm)
                   → Mobile shows NumericPad for bale count
                   → POST /confirm-parcel-done { assignmentId, baleCount }
                   → Server: mark assignment done + create bale_production
```

See [Backend](backend.md) for geofence service, [Mobile](mobile.md) for GeofenceOverlay.

## Background Jobs (BullMQ)

```
JobSchedulerService.onModuleInit()
  │
  ├── geofence-check     every 5 min    → GeofenceProcessor
  ├── alert-evaluation   every 15 min   → AlertsProcessor
  ├── reconciliation     every 1 hour   → ReconciliationProcessor
  ├── sync-cleanup       daily 02:00    → SyncCleanupProcessor
  └── cmr-generation     on-demand      → CmrProcessor (triggered at trip complete)
```

Redis is required for BullMQ (password-protected in production).

## Real-Time Architecture (Admin Dashboard)

```
Supabase Realtime (WebSocket)
  │
  ├── trips changes ──→ invalidate queryKeys.trips.all
  ├── task_assignments ──→ invalidate queryKeys.taskAssignments.all
  ├── alerts ──→ invalidate queryKeys.alerts.all
  ├── parcel_daily_status ──→ invalidate queryKeys.parcelDailyStatus.all
  ├── delivery_destinations ──→ invalidate queryKeys.deliveryDestinations.all
  └── geofence_events ──→ invalidate queryKeys.taskAssignments.all
```

Reconnects with exponential backoff (max 10 retries, 1s → 30s). On reconnect: invalidates ALL queries to catch up.

## Database (PostgreSQL + PostGIS)

**20+ tables** across domains:
- **Core**: users, machines, parcels, farms, delivery_destinations
- **Operations**: trips, bale_loads, bale_productions, fuel_logs, consumable_logs, task_assignments
- **Support**: documents, alerts, audit_logs, geofence_events, device_push_tokens, parcel_daily_status
- **Sync**: sync_idempotency, machine_location_events

**Key patterns**: Soft deletes (deleted_at), sync_version for delta sync, generated columns (net_weight_kg, odometer_distance_km), PostGIS boundaries (Polygon) and points.

See [Database](database.md) for full schema.

## Infrastructure

```
                    Internet
                       │
                    nginx (443/80)
                    ├── /           → admin-web (Next.js, port 3000)
                    └── /api/v1/*   → backend (NestJS/Fastify, port 3001)

Docker Compose:
  ├── backend    (node:22-alpine, non-root, health check)
  ├── admin      (node:22-alpine, non-root)
  ├── nginx      (nginx:alpine, Let's Encrypt)
  ├── redis      (redis:7-alpine, password-protected)
  └── certbot    (certbot:latest, ACME challenge)
```

See [Infrastructure](infrastructure.md) for Docker and nginx details.

## Mobile Offline-First

The mobile app is designed to work without internet:

- **Local SQLite** stores trips, bale_productions, fuel_logs, consumable_logs, bale_loads, task_assignments
- **Sync queue** (outbox pattern) enqueues all local writes for later push
- **Crash recovery**: in_flight entries reset to pending on app startup
- **Delta pull**: server sends only records with sync_version > client's last known version
- **GPS tracking** continues foreground, reports to server when online
- **Map** shows offline message when Leaflet CDN unreachable (graceful degradation)

See [Mobile](mobile.md) and [Sync Protocol](sync-protocol.md).

## CLI Tooling

`./strawboss.sh` — modular orchestrator with 30+ commands:

```
./strawboss.sh setup          # First-time install
./strawboss.sh dev            # Start local dev
./strawboss.sh status         # Full dashboard
./strawboss.sh health         # Health checks
./strawboss.sh mobile-build-local  # Build APK
```

Commands auto-discovered from `scripts/*.sh` via `@cmd` annotations.

See [Scripts](scripts.md) for full command reference.

## Component Documentation Index

| Component | Doc | Key Tech |
|-----------|-----|----------|
| Overall Architecture | [architecture.md](architecture.md) | — |
| NestJS Backend | [backend.md](backend.md) | NestJS 11, Fastify, Drizzle ORM |
| Admin Dashboard | [admin-web.md](admin-web.md) | Next.js 15, TanStack Query, Leaflet |
| Mobile App | [mobile.md](mobile.md) | Expo SDK 54, SQLite, WebView |
| TypeScript Types | [packages-types.md](packages-types.md) | Zero-dep interfaces |
| Validation | [packages-validation.md](packages-validation.md) | Zod schemas |
| Business Logic | [packages-domain.md](packages-domain.md) | XState v5, fraud detection |
| API Hooks | [packages-api.md](packages-api.md) | TanStack Query, ApiClient |
| Design Tokens | [packages-ui-tokens.md](packages-ui-tokens.md) | Tailwind preset, RN helpers |
| Database | [database.md](database.md) | PostgreSQL, PostGIS, RLS |
| Infrastructure | [infrastructure.md](infrastructure.md) | Docker, nginx, Redis |
| Sync Protocol | [sync-protocol.md](sync-protocol.md) | Outbox, delta sync |
| CLI Scripts | [scripts.md](scripts.md) | Bash, cross-platform |
