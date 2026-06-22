---
type: doc
title: "StrawBoss — System Architecture"
created: 2026-04-16
updated: 2026-06-22
tags: [doc, architecture, overview, top-level]
status: mature
related:
  - "[[backend]]"
  - "[[admin-web]]"
  - "[[mobile]]"
  - "[[database]]"
  - "[[sync-protocol]]"
  - "[[infrastructure]]"
  - "[[packages-types]]"
  - "[[packages-domain]]"
---

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
├── supabase/migrations/ PostgreSQL schema (37 migration files)
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

See [[sync-protocol]] for full details.

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

**CMR auto-generation** (two stages via BullMQ): stage 1 at `depart` → partial PDF (status `partial`); stage 2 at `complete` → final PDF (status `generated`).

See [[backend]] for endpoint details, [[packages-domain]] for state machine.

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
                                        hydrateOrganizationFromJwt() fallback
                                        (if JWT hook omits org claims, loads from DB)
                                              │
                                              ▼
                                        RolesGuard (global APP_GUARD)
                                              │
                                              ├── @Public() → skip auth
                                              ├── No @Roles() → any authenticated user
                                              └── @Roles('admin', 'driver') → role check
```

**Roles**: `admin`, `dispatcher`, `baler_operator`, `loader_operator`, `driver`, `geofence_maker`

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

See [[backend]] for geofence service, [[mobile]] for GeofenceOverlay.

## Background Jobs (BullMQ)

```
JobSchedulerService.onModuleInit()
  │
  ├── geofence-check     every 5 min    → GeofenceProcessor
  ├── alert-evaluation   every 15 min   → AlertsProcessor
  ├── reconciliation     every 1 hour   → ReconciliationProcessor
  ├── sync-cleanup       daily 02:00    → SyncCleanupProcessor
  └── cmr-generation     on-demand      → CmrProcessor (stage 1 at depart, stage 2 at complete)
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

See [[database]] for full schema.

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

See [[infrastructure]] for Docker and nginx details.

## Mobile Offline-First

The mobile app is designed to work without internet:

- **Local SQLite** stores trips, bale_productions, fuel_logs, consumable_logs, bale_loads, task_assignments
- **Sync queue** (outbox pattern) enqueues all local writes for later push
- **Crash recovery**: in_flight entries reset to pending on app startup
- **Delta pull**: server sends only records with sync_version > client's last known version
- **GPS tracking** continues foreground, reports to server when online
- **Map** shows offline message when Leaflet CDN unreachable (graceful degradation)

See [[mobile]] and [[sync-protocol]].

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

See [[scripts]] for full command reference.

## Fleet / OTA Self-Update

~30 Device-Owner phones self-install signed APK updates silently via Android's PackageInstaller API. The server cannot initiate connections (NAT / no static IP per device), so the architecture is pure poll-based: phones call `POST /api/v1/fleet/checkin` and the response tells them whether an update is waiting.

### Poll Model

```
Phone (periodic / on-foreground)
  │
  └─ POST /api/v1/fleet/checkin  ──→  NestJS FleetService (no auth required)
       │  { deviceUuid, deviceToken, versionCode,
       │    appVersion, model, osVersion, activeTrip,
       │    otaReports: [{ deploymentId, state, error? }] }
       │
       └─ Response: { deviceId, assignedOrgId, pendingDeployment? }
            pendingDeployment carries: { version, versionCode, apkUrl (signed),
                                         sha256, sizeBytes, installPolicy }
```

- First call = registration: server issues an HMAC `deviceToken` (`HMAC-SHA256(deviceUuid, SUPABASE_JWT_SECRET)`). Every subsequent call must present this token.
- The response's `pendingDeployment` is `null` when the device is already up to date. Non-null means "download + install this APK".
- FCM (`firebase-admin` + `FIREBASE_SERVICE_ACCOUNT`) is optional acceleration: a push nudges the phone to poll sooner. The poll is the authoritative mechanism — FCM being absent just adds latency.

See [[backend]] for `FleetService` / `FleetAdminController`, [[mobile]] for the client-side OTA flow.

### Per-Device OTA State Machine

Backend records state in `device_ota_status`. The device drives forward transitions and reports them in `otaReports[]` on check-in:

```
pending → notified → downloading → downloaded → awaiting_idle → installing → installed
                                                                           → failed
```

- `pending` → `notified`: set by the server at fan-out time (or lazily on first check-in that matches an active deployment).
- `downloading` / `downloaded` / `awaiting_idle` / `installing` / `failed`: reported by the device.
- `installed`: accepted by the server **only when** the device's reported `versionCode` equals the release's `version_code` (anti-skew guard — device re-reports until it boots into the new build).
- Downgrade guard: if `deviceVersionCode >= releaseVersionCode` the server marks the row `installed` immediately and returns `null` for `pendingDeployment`.

### Super-Admin Endpoints (`@Roles(super_admin)`)

All under `/api/v1/super-admin/`:

| Endpoint | Purpose |
|---|---|
| `GET /devices` | List all registered devices with latest OTA state |
| `GET /devices/:id` | Single device |
| `PATCH /devices/:id` | Assign to org, rename |
| `DELETE /devices/:id` | Soft-delete |
| `GET /devices/:id/ota-status` | Per-device deployment history |
| `GET /devices/:id/logs?level=&date=` | Stream filtered device logs from Winston mobile log tree |
| `GET /releases` | List APK releases |
| `POST /releases` | Upload APK (multipart, 250 MB limit); sha256 computed server-side |
| `PATCH /releases/:id` | Change `status` (draft/published/archived), `mandatory`, `changelog` |
| `GET /deployments` | List deployments with per-state counts |
| `POST /deployments` | Create deployment; `scheduledAt` null = immediate, non-null = BullMQ-delayed job |
| `POST /deployments/:id/cancel` | Cancel |

### New DB Tables (migration `00055_fleet_devices.sql`)

Four tables + four enums added. No `sync_version` — these are server-authoritative (not mobile-synced).

| Table | Purpose |
|---|---|
| `devices` | Device registry. `device_uuid` (SecureStore UUID) is the identity key. `device_token_hash` stores the HMAC used to authenticate check-ins. Soft-delete via `deleted_at`. |
| `app_releases` | Uploaded APK metadata. `version_code UNIQUE` prevents duplicate/collision. APK file lives at `UPLOADS_ROOT/apks/<uuid>.apk`; `sha256` is verified on-device before install. |
| `ota_deployments` | One release pushed to a device set. `target_kind`: `all` / `org` / `device_set`. `force_now` bypasses the idle gate. Scheduled deployments use a BullMQ delayed job (`QUEUE_OTA_DEPLOY`). |
| `device_ota_status` | Per-device state-machine instance for one deployment. `UNIQUE(deployment_id, device_id)`. |

Enums: `ota_state`, `ota_deployment_status`, `release_status`, `ota_target_kind`.

RLS is enabled on all four tables but the backend connects as table owner (bypasses RLS). One permissive read policy on `devices` allows org-admins to see their assigned devices via a future direct PostgREST path.

See [[database]] for full schema, [[admin-web]] for the super-admin Fleet pages.

## Component Documentation Index

| Component | Doc | Key Tech |
|-----------|-----|----------|
| Overall Architecture | [[architecture]] | — |
| NestJS Backend | [[backend]] | NestJS 11, Fastify, Drizzle ORM |
| Admin Dashboard | [[admin-web]] | Next.js 15, TanStack Query, Leaflet |
| Mobile App | [[mobile]] | Expo SDK 54, SQLite, WebView |
| TypeScript Types | [[packages-types]] | Zero-dep interfaces |
| Validation | [[packages-validation]] | Zod schemas |
| Business Logic | [[packages-domain]] | XState v5, fraud detection |
| API Hooks | [[packages-api]] | TanStack Query, ApiClient |
| Design Tokens | [[packages-ui-tokens]] | Tailwind preset, RN helpers |
| Database | [[database]] | PostgreSQL, PostGIS, RLS |
| Infrastructure | [[infrastructure]] | Docker, nginx, Redis |
| Sync Protocol | [[sync-protocol]] | Outbox, delta sync |
| CLI Scripts | [[scripts]] | Bash, cross-platform |
