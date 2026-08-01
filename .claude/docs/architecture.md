---
type: doc
title: "StrawBoss — System Architecture"
created: 2026-04-16
updated: 2026-07-31
tags: [doc, architecture, overview, top-level, fleet, tailscale, roles, aux-stage, feature-toggles]
status: mature
related:
  - "[[backend]]"
  - "[[admin-web]]"
  - "[[mobile]]"
  - "[[database]]"
  - "[[sync-protocol]]"
  - "[[infrastructure]]"
  - "[[scripts]]"
  - "[[packages-types]]"
  - "[[packages-domain]]"
  - "[[feature-toggles]]"
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
├── supabase/migrations/ PostgreSQL schema (91 migration files, 00001–00091)
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

### Auxiliary Trips — a second, collapsed lifecycle (Jul 2026)

An auxiliary (external-hauler) transport does **not** run through the eight-step machine above — its
`trips` row is collapsed: `planned → loading → loaded → completed` (no `in_transit` / `arrived` /
`delivering` / `delivered`; `loaded → completed` happens via `applyAuxiliaryLoadedSideEffects` + a
delayed auto-complete). It is also born on a *different* table first: a public/authenticated portal
submission creates a `trip_requests` row (`status: pending → confirmed → cancelled`), and the `trips`
row is only materialized later — sometimes days later — when a dispatcher assigns a loader on the
truck board (`autoUpsertAuxiliaryTrip`). `trip_requests.status` is never written again after
`confirm()`, so it freezes at `confirmed` while the truck is out being loaded.

Because neither table alone tells the truth, `composeAuxStage()` (`@strawboss/domain`,
`rules/aux-stage.ts`) collapses both axes into one honest `AuxStage` (`pending → unplanned → planned →
loading → awaitingSignature/signed → completed`, plus `cancelled`). Rule of thumb: **once a trip
exists, the trip's `TripStatus` wins** over the stale request status; `unplanned` is the case with no
trip yet (confirmed, one-time aux truck minted, nobody has scheduled it — previously invisible to the
product); `loaded` splits into `awaitingSignature`/`signed` because the external driver still owes a
signature on the paper CMR via the one-time public link. `AuxStage` is pure/derived — no new column,
no migration — and is read by both the admin Curse-Aux ledger and (in principle) reports/alerts.

**Admin surface (Jul 2026):** the old standalone `/trip-requests` page was folded into the Curse page
(`/trips`) as one page with two ledgers — an intake strip of pending portal requests as decision
cards, a "Curse Aux" table (one row per `trip_requests`, keyed on the *request* id since that's the
only identity stable across the whole life of an aux transport, joined server-side to its live trip
via `LEFT JOIN LATERAL ... ON trips.trip_request_id`), and "Curse normale" (`isAuxiliary=false`
own-fleet trips) — two independent server-scoped queries, not a client-side split of one fetch. The old
`/trip-requests` route now 301-redirects to `/trips#aux` rather than being deleted, to preserve
bookmarks/links. See [[admin-web]] for the page/component breakdown.

See [[backend]] for endpoint details, [[packages-domain]] for state machine, [[packages-types]] for `AuxStage`.

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

### Roles / Account Types

Nine values in `UserRole` (`packages/types/src/entities/user.ts`). All are enforced via `@Roles()` on
the backend and RLS in the DB; platform column is where the account actually gets a UI:

| Role | Platform | Notes |
|---|---|---|
| `super_admin` | Web (`/super-admin`) | Cross-org: fleet/OTA/devices, org management. No `organization_id`. |
| `admin` | Web | Org admin — accounts, machines, parcels, farms, reports. |
| `dispatcher` | Web | Plans trips/tasks, confirms trip requests. |
| `baler_operator` | Mobile (`(baler)`) | Runs a baler machine, logs bale production. |
| `loader_operator` | Mobile (`(loader)`) | Runs a loader, confirms loads onto trucks. |
| `driver` | Mobile (`(driver)`) | Drives a truck through the trip lifecycle. |
| `geofence_maker` | Mobile (`(geofence)`) | Draws/edits parcel boundaries in the field. No assigned machine. |
| `depot_manager` | Mobile (`(deposit)`) | Confirms depot deliveries/weighing/inventory for `users.assigned_delivery_destination_id`. No assigned machine. |
| `transportator` | **Web only** (added Jul 2026) | External hauler, no mobile app, no machine, no depot. Read-only ledger of the trip requests it created (`trip_requests.created_by_user_id`) plus an authenticated copy of the beneficiary request form, scoped to admin-assigned beneficiaries (`transporter_beneficiaries` M:N, migration `00087`). See [[database]], [[admin-web]]. |

**Mobile role-based routing**: Auth gate in `_layout.tsx` redirects to role-specific tab layout after login. `transportator` has no mobile route group — it is rejected/has nothing to route to on the phone by design.

## Per-Organization Feature Toggles

Full detail in [[feature-toggles]]; summary here for the top-level system map. A `super_admin` can switch
product modules/features off for one tenant — **a product gate, never a security gate**: auth, the trip
state machine, task assignments, sync, org scoping and soft deletes are never in this system.

```
packages/types/src/features.ts       (REGISTRY — 10 modules, 47 leaves, all defaultEnabled: true)
        │
        ▼
organizations.feature_overrides      (OVERRIDES — sparse JSONB, migration 00093)
        │
        ▼
resolveDisabledFeatures()            (RESOLUTION — defaults <- overrides <- dependency closure)
        │
        ├──→ AuthGuard user-context join ──→ FeaturesGuard (3rd global guard) ──→ @RequireFeature routes
        ├──→ FeaturesService.getDisabledForOrg() ──→ @Public() routes (assertEnabledForOrg, in-service)
        ├──→ GET /profile → admin-web useFeatures() → FeatureRouteGuard + per-page UI gating
        └──→ /fleet/checkin, /profile → mobile useFeaturesStore() → useIsFeatureEnabled / featureTabOptions
```

Fail-open is structural: the wire format is the *disabled* list only, so a client that never received it
(an offline boot, an old APK) behaves as fully-enabled. A Redis generation counter (`FeaturesCacheService`)
invalidates the per-replica cache across the two backend replicas within ~2s of a super-admin save — TTL
alone would otherwise read on/off/on to the same browser for ~55s. As of `e275b3c` (2026-07-31) the system
is **57/57 wired**: every switchable key gates something real, and `scripts/check-features.mjs` mechanically
enforces that every backend write route is either `@RequireFeature`-decorated or on an explicit, reasoned
exemption list. See [[backend]], [[mobile]], [[admin-web]], [[packages-types]], [[database]], [[scripts]].

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
  ├── trips changes ──→ invalidate queryKeys.trips.all AND queryKeys.tripRequests.all
  │                      (Jul 2026: a trip status change mutates the Curse-Aux read model too,
  │                       since it's joined server-side to its live trip — see Auxiliary Trips)
  ├── trip_requests changes ──→ invalidate queryKeys.tripRequests.all (+ .detail(id) on UPDATE)
  │                      (Jul 2026, commit 6cab8fe: trip_requests was never in this channel
  │                       before the Curse-Aux merge; fail-safe no-op if not yet in the
  │                       supabase_realtime publication — self-heals via 60s staleTime)
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

## Fleet Tailscale Remote Access

A second remote-access channel overlays the poll-based OTA architecture. Where the OTA check-in is device-initiated (outbound HTTP, works through NAT), the Tailscale channel makes the VM capable of reaching any fleet phone for debugging and ADB access.

### Model

```
VM host (tailscaled, miro user)
  │
  ├─ tailscale status --json ──→ scripts/tailscale-sync.mjs ──→ SQL UPDATE devices
  │   (systemd timer, every 60s)                                  tailscale_online / ip / last_seen
  │
  └─ adb connect <tailscale-ip>:5555 ──→ ADB shell (over Tailscale P2P tunnel)
      (fleet:tunnel command, interactive)
```

The backend Docker container runs on a bridge network and **cannot** reach the tailnet. All fleet-host commands run on the VM via `scripts/10-fleet.sh`. The 60-second systemd timer (`deploy/systemd/strawboss-fleet-sync.{service,timer}`) feeds the red/green dot in the [[admin-web]] super-admin Fleet UI.

### MDM / Tailscale app control

- Tailscale is managed on the Device-Owner phones as a controlled install (not Play Store).
- The official Tailscale APK is hosted under `{UPLOADS_ROOT}/tailscale/tailscale.apk` — uploaded once via the super-admin API and served via the existing signed-URL mechanism.
- The OTA check-in response can carry a `tailscaleApkUrl` so a freshly provisioned phone can install Tailscale without Play Store access.
- The super-admin can toggle `tailscale_desired` per device (`PATCH /super-admin/devices/:id/tailscale`); the [[mobile]] client reads this flag on check-in and enables/disables the Tailscale MDM profile accordingly.

### Per-device ephemeral keys

Ephemeral Tailscale auth keys are issued per device via the OAuth client stored in `app_settings` (never in the repo). Keys auto-expire; the [[backend]] `FleetService` issues a fresh key on demand so the phone can join or re-join the tailnet without admin interaction.

### Auth key / OAuth storage

- Stored in [[database]] `app_settings` table.
- Read/written only via `GET|PUT /api/v1/super-admin/settings/tailscale` (raw secrets never returned by GET — masked booleans only).

### Online dot — data flow

```
tailscale status --json (host)
  │
  └─ tailscale-sync.mjs ──→ SQL emitted to stdout
       │  1. UPDATE devices SET tailscale_online = false  (reset all)
       │  2. UPDATE devices SET tailscale_online = true,
       │         tailscale_ip = '100.x.x.x',
       │         tailscale_last_seen = <p.LastSeen>
       │     WHERE tailscale_hostname = '<lower(p.HostName)>'
       │
       └─ piped to psql "$DATABASE_URL"
            │
            └─ [[admin-web]] Fleet page reads tailscale_online col → red/green dot
```

Cross-references: [[backend]] (FleetService, OTA check-in, settings endpoints), [[mobile]] (Tailscale MDM, OTA client), [[admin-web]] (Fleet super-admin pages, online dot), [[database]] (devices table, app_settings), [[scripts]] (fleet:* commands), [[infrastructure]] (systemd timer, ADB-over-TCP).

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
| Feature Toggles | [[feature-toggles]] | Per-org registry, presets, guard/decorator |
| CLI Scripts | [[scripts]] | Bash, cross-platform |
