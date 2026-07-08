---
type: doc
title: "Backend Service (backend/service)"
created: 2026-04-16
updated: 2026-07-08
tags: [doc, backend, layer, nestjs, drizzle, bullmq]
status: mature
related:
  - "[[architecture]]"
  - "[[database]]"
  - "[[sync-protocol]]"
  - "[[packages-domain]]"
  - "[[packages-types]]"
  - "[[packages-validation]]"
  - "[[packages-api]]"
---

# Backend Service (`backend/service`)

NestJS 11 + Fastify 5 REST API. All routes under `/api/v1/`. Database access via Drizzle ORM + postgres.js. Background jobs via BullMQ + Redis.

Entry point: `backend/service/src/main.ts` -- boots a `NestFastifyApplication`, sets global prefix `api/v1`, configures CORS, listens on `PORT` (default 3001). Enables graceful shutdown via `app.enableShutdownHooks()` + `process.on('SIGTERM'/'SIGINT')` → `await app.close()`, which drains in-flight HTTP requests and fires `onModuleDestroy` on all modules (closes BullMQ workers). Required for zero-downtime Swarm rolling deploys; pairs with `stop_grace_period` in `docker-stack.yml`.

---

## Module Structure

The `AppModule` (`src/app.module.ts`) imports 31 feature modules:

| Module | Path | Purpose |
|---|---|---|
| `AppLoggerModule` | `src/logger/logger.module.ts` | Winston factory with daily-rotate-file transports (`logs/web/{all,error,warn,info,flow,http,debug}/`) |
| `HealthModule` | `src/health/` | Public liveness endpoint |
| `ConfigModule` | `src/config/config.module.ts` | `@nestjs/config` with Zod env validation (`src/config/env.validation.ts`) |
| `DatabaseModule` | `src/database/database.module.ts` | `DrizzleProvider` -- singleton postgres.js + Drizzle ORM connection. `public client` exposes the raw postgres.js instance for reserved-connection work (e.g. advisory locks). Pool capped: `max: 8, idle_timeout: 20, connect_timeout: 10` for 2 Swarm replicas on the Supabase session-mode pooler (~16 steady, ~24 peak during rolling deploy). |
| `AuthModule` | `src/auth/auth.module.ts` | Global module exporting `AuthGuard` and `RolesGuard` |
| `ParcelsModule` | `src/parcels/` | CRUD for parcels (fields/plots) |
| `MachinesModule` | `src/machines/` | CRUD for trucks, balers, loaders |
| `TaskAssignmentsModule` | `src/task-assignments/` | Daily task planning, board views, bulk create |
| `TripsModule` | `src/trips/` | Trip lifecycle (10 state transitions) + create/list |
| `BaleLoadsModule` | `src/bale-loads/` | Bale loads per trip |
| `BaleProductionsModule` | `src/bale-productions/` | Baler production logs + stats |
| `FuelLogsModule` | `src/fuel-logs/` | Fuel consumption logs + stats |
| `ConsumableLogsModule` | `src/consumable-logs/` | Twine/consumable logs + stats |
| `DocumentsModule` | `src/documents/` | Document registry + CMR sub-module |
| `AlertsModule` | `src/alerts/` | Alert CRUD + BullMQ alert-evaluation processor |
| `AuditModule` | `src/audit/` | `AuditInterceptor` + `AuditService` for change tracking |
| `SyncModule` | `src/sync/` | Mobile push/pull sync + cleanup processor |
| `ReconciliationModule` | `src/reconciliation/` | Bale/fuel reconciliation + BullMQ processor |
| `LocationModule` | `src/location/` | GPS position reporting and route history |
| `AdminUsersModule` | `src/admin-users/` | User management (admin-only CRUD) |
| `DashboardModule` | `src/dashboard/` | Aggregate KPI queries |
| `JobsModule` | `src/jobs/` | BullMQ queue registration + `JobSchedulerService` |
| `TrpcModule` | `src/trpc/` | tRPC context/router (secondary API layer) |
| `ProfileModule` | `src/profile/` | Self-service profile CRUD + password change |
| `FarmsModule` | `src/farms/` | Farm entity CRUD |
| `ParcelDailyStatusModule` | `src/parcel-daily-status/` | Per-parcel per-day status (done/not-done) |
| `DeliveryDestinationsModule` | `src/delivery-destinations/` | Delivery deposit CRUD with geofence boundaries |
| `NotificationsModule` | `src/notifications/` | Expo push token registration + send + geofence confirm |
| `GeofenceModule` | `src/geofence/` | ST_Contains polling + enter/exit detection |
| `MobileLogsModule` | `src/mobile-logs/` | Ingest batched NDJSON log entries from mobile devices; persists optional `deviceId` in Winston meta |
| `DepositInventoryModule` | `src/deposit-inventory/` | Depot list and inventory for `depot_manager` role (Plan C) |
| `ReportsModule` | `src/reports/` | Extended report queries (KmPerTruck, etc.) |
| `FleetModule` | `src/fleet/` | Device registry, OTA releases/deployments, FCM acceleration push; see [[backend#Fleet Module (OTA)]] |

Global providers (registered in `AppModule.providers`):

- `APP_GUARD: AuthGuard` -- JWT verification on every route (unless `@Public()`)
- `APP_GUARD: RolesGuard` -- role enforcement via `@Roles()` decorator
- `APP_INTERCEPTOR: LoggingInterceptor` -- assigns `X-Request-Id`, logs HTTP lines
- `APP_FILTER: AllExceptionsFilter` -- catches all exceptions, structured JSON error response

---

## Auth System

### JWT Verification (`src/auth/auth.guard.ts`)

`AuthGuard` peeks at the JWT header `alg` field to route verification:

- **HS256** (legacy): verifies with `SUPABASE_JWT_SECRET` via `jose.jwtVerify()`
- **ES256 / RS256** (modern): verifies via JWKS fetched from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` using `jose.createRemoteJWKSet()`

Role extraction order: `payload.app_metadata.role` -> `payload.user_role` -> `payload.role`

**Organization hydration fallback**: if the JWT hook omits org claims, `hydrateOrganizationFromJwt()` loads them from the DB before attaching the user to the request.

The resolved user is attached to `request.user` as `RequestUser { id, email, role }`.

### Decorators

- `@Public()` (`src/auth/auth.guard.ts`) -- sets `isPublic` metadata, skips AuthGuard
- `@Roles(...roles)` (`src/auth/roles.guard.ts`) -- restricts to listed `UserRole` values; throws `ForbiddenException` if mismatch
- `@CurrentUser()` (`src/auth/current-user.decorator.ts`) -- parameter decorator extracting `RequestUser` from request

---

## Endpoint Inventory

### Health (`src/health/health.controller.ts`)
- `GET /health` -- @Public -- returns `{ status: 'ok', timestamp }`

### Trips (`src/trips/trips.controller.ts`)
- `GET /trips` -- any authenticated -- list with filters: status, driverId, truckId, sourceParcelId, dateFrom, dateTo
- `GET /trips/:id` -- any authenticated -- single trip by ID
- `POST /trips` -- @Roles(admin, dispatcher) -- create a new trip (status: planned)
- `POST /trips/:id/start-loading` -- @Roles(admin, loader_operator) -- planned -> loading
- `POST /trips/:id/complete-loading` -- @Roles(admin, loader_operator) -- loading -> loaded (validates bale_loads > 0; saves `loaderSignatureUrl`)
- `POST /trips/:id/depart` -- @Roles(admin, driver) -- loaded -> in_transit (records departure odometer; saves `driverSignatureUrl`; queues CMR stage 1)
- `POST /trips/:id/arrive` -- @Roles(admin, driver) -- in_transit -> arrived (calculates odometer distance)
- `POST /trips/:id/start-delivery` -- @Roles(admin, driver) -- arrived -> delivering
- `POST /trips/:id/confirm-delivery` -- @Roles(admin, driver) -- delivering -> delivered (records gross weight, computes net from truck tare; saves `deterioratedBalesCount`)
- `POST /trips/:id/complete` -- @Roles(admin, driver) -- delivered -> completed (records receiver signature; queues CMR stage 2)
- `POST /trips/:id/cancel` -- @Roles(admin) -- any pre-completed -> cancelled
- `POST /trips/:id/dispute` -- @Roles(admin) -- delivered -> disputed
- `POST /trips/:id/resolve-dispute` -- @Roles(admin) -- disputed -> completed or delivered
- `POST /trips/:id/next-iteration` -- @Roles(admin, loader_operator) -- create next iteration trip for same course (Plan C multi-iteration)
- `POST /trips/:id/recall-loader` -- @Roles(admin, dispatcher) -- send loader-recall push when truck is idle (Plan C)

### CMR (`src/documents/cmr/cmr.controller.ts`)
- `POST /trips/:tripId/generate-cmr` -- @Roles(admin, dispatcher) -- on-demand CMR PDF generation

### Sync (`src/sync/sync.controller.ts`)
- `POST /sync/push` -- any authenticated -- push offline mutations (insert/update/delete) with idempotency
- `POST /sync/pull` -- any authenticated -- delta pull (records with sync_version > requested)
- `GET /sync/status` -- any authenticated -- last processed version per table for client

### Location (`src/location/location.controller.ts`)
- `POST /location/report` -- any authenticated -- store GPS ping (lat, lon, accuracy, heading, speed); also calls `ProfileService.touchLastSeen(operatorId)` best-effort (non-fatal) to refresh `users.last_seen_at` — keeps machine-bound operators "online" on the dashboard while their JS heartbeat is paused (backgrounded). See [[backend]] module deps: `LocationModule` imports `ProfileModule`.
- `POST /location/report/batch` -- any authenticated -- batch variant of `report`: body `{ reports: LocationReportDto[] }`, 1–30 items, for flushing the mobile offline outbox in one request. `LocationService.reportLocationBatch()` hoists the per-request work (assigned-machine lookup, org check, `touchLastSeen`, geofence nudge) to run once per batch instead of once per item, then does one multi-row `INSERT ... ON CONFLICT DO NOTHING`. Returns 204 even when every row was a duplicate. No `ZodValidationPipe`/`@strawboss/validation` schema exists for location bodies (matches the single endpoint's pattern — plain typed DTO + manual bounds checks in the service); the 1–30 size check and lat/lon range check are manual `BadRequestException`s in the service, same as `reportLocation`. Old app builds keep using the single endpoint unmodified during rollout.
- `GET /location/machines` -- @Roles(admin) -- last known position of all machines. Reads `machine_last_positions` (migration 00081, one row per machine, kept current by an `AFTER INSERT` trigger on `machine_location_events`) instead of a `SELECT DISTINCT ON` scan over full `machine_location_events` history — same output columns/org-scoping, no time window (a machine parked for weeks still shows its last fix).
- `GET /location/related-machines` -- any authenticated -- positions of machines sharing today's assignments (siblings via parent_assignment_id)
- `GET /location/machines/:machineId/route?from=...&to=...` -- @Roles(admin) -- GPS route history (up to 50,000 points)
- `GET /location/machines/:machineId/km-by-day?from=...&to=...` -- @Roles(admin) -- km driven per day (returns `KmByDayResponse`)

### Profile (`src/profile/profile.controller.ts`)
- `GET /profile` -- any authenticated -- current user's profile
- `PATCH /profile` -- any authenticated -- update fullName, phone, locale, notificationPrefs
- `POST /profile/change-password` -- any authenticated -- change password

### Notifications (`src/notifications/notifications.controller.ts`)
- `POST /notifications/register-token` -- any authenticated -- register/update Expo push token
- `POST /notifications/confirm-parcel-done` -- @Roles(admin, baler_operator) -- mark assignment done + record bale production
- `POST /notifications/loader-recall-response` -- @Roles(loader_operator) -- loader's yes/no answer to a truck-idle recall prompt (Plan C)

### Bale Productions (`src/bale-productions/bale-productions.controller.ts`)
- `GET /bale-productions` -- any authenticated -- list with filters (operatorId, parcelId, dateFrom, dateTo)
- `GET /bale-productions/stats` -- any authenticated -- aggregated stats (groupBy: operator/parcel/date)
- `POST /bale-productions` -- @Roles(baler_operator, admin) -- create production record

### Dashboard (`src/dashboard/dashboard.controller.ts`)
- `GET /dashboard/overview` -- any authenticated -- KPI: balesToday, activeTrips, tripsToday, activeMachines, pendingAlerts
- `GET /dashboard/production` -- any authenticated -- production statistics
- `GET /dashboard/costs` -- any authenticated -- fuel/consumable cost breakdown
- `GET /dashboard/trending` -- any authenticated -- daily bale/trip counts over recent window
- `GET /dashboard/anti-fraud` -- any authenticated -- fraud flag summary

### Documents (`src/documents/documents.controller.ts`)
- `GET /documents` -- any authenticated -- list (filter by tripId, documentType)
- `GET /documents/:id` -- any authenticated -- single document metadata
- `GET /documents/:id/download` -- any authenticated -- redirect to file URL

### Alerts (`src/alerts/alerts.controller.ts`)
- `POST /alerts` -- @Roles(admin) -- create alert manually
- `GET /alerts` -- any authenticated -- list (filter by category, severity, isAcknowledged)
- `GET /alerts/unacknowledged` -- any authenticated -- pending alerts only
- `PATCH /alerts/:id/acknowledge` -- @Roles(admin, dispatcher) -- acknowledge an alert

### Task Assignments (`src/task-assignments/task-assignments.controller.ts`)
- `GET /task-assignments` -- any authenticated -- list (filter by date, machineId, userId, status)
- `GET /task-assignments/board/:date` -- any authenticated -- kanban board view
- `GET /task-assignments/daily-plan/:date` -- any authenticated -- grouped daily plan (available / inProgress / done)
- `GET /task-assignments/by-machine-type/:date/:machineType` -- any authenticated -- filtered by machine type
- `POST /task-assignments` -- @Roles(admin, dispatcher) -- create single assignment
- `POST /task-assignments/bulk` -- @Roles(admin, dispatcher) -- batch create (array validated via Zod)
- `PATCH /task-assignments/:id/status` -- @Roles(admin, dispatcher) -- update status
- `PATCH /task-assignments/:id` -- @Roles(admin, dispatcher) -- update fields
- `POST /task-assignments/auto-complete` -- @Roles(admin, dispatcher) -- auto-complete past assignments before given date
- `DELETE /task-assignments/:id` -- @Roles(admin, dispatcher) -- soft delete

### Parcels (`src/parcels/parcels.controller.ts`)
- `GET /parcels` -- any authenticated -- list (filter by municipality, isActive)
- `GET /parcels/:id` -- any authenticated -- single parcel
- `GET /parcels/:id/bale-availability` -- any authenticated -- produced/loaded/available bale counts
- `POST /parcels` -- @Roles(admin) -- create parcel
- `PATCH /parcels/:id` -- @Roles(admin) -- update parcel (including boundary)
- `DELETE /parcels/:id` -- @Roles(admin) -- soft delete

### Machines (`src/machines/machines.controller.ts`)
- `GET /machines` -- any authenticated -- list (filter by machineType, isActive)
- `GET /machines/:id` -- any authenticated -- single machine
- `POST /machines` -- @Roles(admin) -- create machine
- `PATCH /machines/:id` -- @Roles(admin) -- update machine
- `DELETE /machines/:id` -- @Roles(admin) -- soft delete

### Farms (`src/farms/farms.controller.ts`)
- `GET /farms` -- any authenticated -- list all
- `GET /farms/:id` -- any authenticated -- single farm
- `POST /farms` -- @Roles(admin) -- create
- `PATCH /farms/:id` -- @Roles(admin) -- update
- `DELETE /farms/:id` -- @Roles(admin) -- soft delete

### Delivery Destinations (`src/delivery-destinations/delivery-destinations.controller.ts`)
- `GET /delivery-destinations` -- any authenticated -- list (filter by isActive)
- `GET /delivery-destinations/:id` -- any authenticated -- single
- `POST /delivery-destinations` -- @Roles(admin) -- create (with boundary for geofence)
- `PATCH /delivery-destinations/:id` -- @Roles(admin) -- update
- `DELETE /delivery-destinations/:id` -- @Roles(admin) -- soft delete

### Bale Loads (`src/bale-loads/bale-loads.controller.ts`)
- `GET /bale-loads` -- any authenticated -- list (filter by tripId, parcelId)
- `POST /bale-loads` -- @Roles(loader_operator, admin) -- create bale load record

### Fuel Logs (`src/fuel-logs/fuel-logs.controller.ts`)
- `GET /fuel-logs` -- any authenticated -- list (filter by machineId, dateFrom, dateTo)
- `GET /fuel-logs/stats` -- any authenticated -- aggregated fuel stats
- `POST /fuel-logs` -- @Roles(admin, baler_operator, loader_operator, driver) -- create

### Consumable Logs (`src/consumable-logs/consumable-logs.controller.ts`)
- `GET /consumable-logs` -- any authenticated -- list (filter by machineId, parcelId)
- `GET /consumable-logs/stats` -- any authenticated -- aggregated consumable stats
- `POST /consumable-logs` -- @Roles(admin, baler_operator, loader_operator, driver) -- create

### Admin Users (`src/admin-users/admin-users.controller.ts`)
- `GET /admin/users` -- @Roles(admin) -- list all users
- `POST /admin/users` -- @Roles(admin) -- create user
- `PATCH /admin/users/:id` -- @Roles(admin) -- update user
- `DELETE /admin/users/:id` -- @Roles(admin) -- deactivate (204)

### Parcel Daily Status (`src/parcel-daily-status/parcel-daily-status.controller.ts`)
- `GET /parcel-daily-status?date=...` -- any authenticated -- list status entries for a date
- `PUT /parcel-daily-status` -- @Roles(admin, dispatcher) -- upsert (parcelId + statusDate)
- `DELETE /parcel-daily-status?parcelId=...&date=...` -- @Roles(admin, dispatcher) -- remove entry (204)

### Mobile Logs (`src/mobile-logs/mobile-logs.controller.ts`)
- `POST /logs/mobile` -- any authenticated -- ingest NDJSON log entries (validated via `mobileLogIngestSchema`)

### Deposit Inventory (`src/deposit-inventory/deposit-inventory.controller.ts`)
- `GET /deposit-inventory/depots` -- any authenticated -- list depots for the caller's org (Plan C)
- `GET /deposit-inventory/:depotId` -- any authenticated -- inventory + incoming trips for a depot (org-scoped)

### Profile Heartbeat
- `POST /profile/heartbeat` -- any authenticated -- updates `users.last_seen_at` to now (mobile calls every 30s, Plan C)

### Fleet — public (`src/fleet/fleet.controller.ts`)
- `POST /fleet/checkin` -- @Public -- device check-in / registration; see [[backend#Fleet Module (OTA)]]

### Fleet — super-admin (`src/fleet/fleet-admin.controller.ts`)
- `GET /super-admin/devices` -- @Roles(super_admin) -- list all registered devices with latest OTA state
- `GET /super-admin/devices/:id` -- @Roles(super_admin) -- single device
- `PATCH /super-admin/devices/:id` -- @Roles(super_admin) -- rename device or assign to org (`updateDeviceSchema`)
- `DELETE /super-admin/devices/:id` -- @Roles(super_admin) -- soft delete
- `GET /super-admin/devices/:id/ota-status` -- @Roles(super_admin) -- full OTA status history for a device (last 200 rows)
- `GET /super-admin/devices/:id/logs?level=&date=` -- @Roles(super_admin) -- device log viewer; reads mobile Winston log files, filters NDJSON lines by `deviceUuid` (last 1000 matching lines)
- `GET /super-admin/releases` -- @Roles(super_admin) -- list APK releases (newest first, max 500)
- `POST /super-admin/releases` -- @Roles(super_admin) -- upload APK (multipart/form-data, up to 250 MB; fields: `version`, `versionCode`, `changelog?`, `mandatory?` + file part `apk`; SHA-256 computed on ingest)
- `PATCH /super-admin/releases/:id` -- @Roles(super_admin) -- update release metadata (status, mandatory, changelog)
- `GET /super-admin/deployments` -- @Roles(super_admin) -- list deployments with per-state device counts
- `POST /super-admin/deployments` -- @Roles(super_admin) -- create deployment (`createDeploymentSchema`); immediate if no `scheduledAt`, otherwise queues a BullMQ delayed job
- `POST /super-admin/deployments/:id/cancel` -- @Roles(super_admin) -- cancel a deployment
- `PATCH /super-admin/devices/:id/tailscale` -- @Roles(super_admin) -- set `tailscale_desired` on a device; triggers best-effort FCM wake push so the device checks in quickly (`setDeviceTailscaleSchema`: `{ desired: boolean }`)
- `GET /super-admin/settings/tailscale` -- @Roles(super_admin) -- read masked global Tailscale settings (raw secrets never returned; fields: `tailscaleAuthKeySet`, `tailscaleOauthConfigured`, `tailscaleTailnet`, `tailscaleTag`, `tailscaleApkSet`, `updatedAt`)
- `PUT /super-admin/settings/tailscale` -- @Roles(super_admin) -- update global Tailscale settings (`updateTailscaleSettingsSchema`: `authKey`, `tailnet`, `oauthClientId`, `oauthClientSecret`, `tag`; send `''` to clear a field, omit to leave unchanged)
- `POST /super-admin/settings/tailscale-apk` -- @Roles(super_admin) -- upload the official Tailscale APK (multipart field `apk`, max 250 MB); stores at `{UPLOADS_ROOT}/tailscale/tailscale.apk`; records SHA-256 and size in `app_settings`; overwrites any previous APK; returns masked `AppSettings`

Note: `users.last_seen_at` is also refreshed via `POST /location/report` (Layer 1 presence). Machine-bound operators whose JS heartbeat is paused when backgrounded still stay "online" because their device foreground service continues to stream GPS. The two paths are independent; the GPS path is best-effort and never fails the location report.

---

## Sync Service (`src/sync/sync.service.ts`)

### Syncable tables
`trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `task_assignments`, `machines`, `parcels`

### Column allowlist
`ALLOWED_COLUMNS` maps each table to a `Set<string>` of permitted column names. `validateColumnName()` is called before any `sql.raw()` to prevent injection.

### Push flow
1. **Idempotency check**: `SELECT FROM sync_idempotency WHERE client_id + table_name + record_id + client_version` -- returns cached result if already processed
2. **Apply mutation**: `insert` (with `sync_version = 1`), `update` (increments `sync_version`), `delete` (soft-delete, increments `sync_version`)
3. **Record in `sync_idempotency`**: stores `server_version` and `result_data` for future dedup

### Pull flow
Delta sync: `SELECT * FROM "{table}" WHERE sync_version > {sinceVersion} ... LIMIT 1000`. Ownership scoping: trips are filtered by `driver_id` or `loader_operator_id`; bale_productions/fuel_logs/consumable_logs/bale_loads by `operator_id`.

### Cleanup (`src/sync/sync-cleanup.processor.ts`)
BullMQ processor on `sync-cleanup` queue. Deletes `sync_idempotency` records older than 30 days.

---

## Geofence Service (`src/geofence/geofence.service.ts`)

`checkMachinePositions()` runs every 5 minutes via the `geofence-check` BullMQ queue:

1. Fetches active assignments for today (`status IN ('available', 'in_progress')`)
2. Gets latest GPS from `machine_location_events` (within 10 minutes)
3. For each assignment, runs `ST_Contains(boundary, ST_MakePoint(lon, lat))` against the target parcel or delivery_destination
4. Compares with last `geofence_events` record for that machine+geofence pair
5. **Enter**: records event, updates assignment to `in_progress`, sends Expo push (`field_entry` or `deposit_entry`)
6. **Exit**: records event, sends `geofence_exit_confirm` push to baler operators (prompts bale count)

---

## CMR Generation (`src/documents/cmr/`)

Two-stage generation via BullMQ:

- **Stage 1** (at `depart`): `TripsService.depart()` queues `{ tripId, stage: 1 }`. Produces a partial PDF; document status set to `partial`.
- **Stage 2** (at `complete`): `TripsService.complete()` queues `{ tripId, stage: 2 }`. Produces the final PDF; document status set to `generated`.

- `CmrService` (`cmr.service.ts`): loads `cmr.hbs` Handlebars template at construction. `generateCmr(tripId, stage)` fetches trip + parcel + truck + driver + bale_loads, renders HTML, converts to PDF via Puppeteer (`headless: true, --no-sandbox`), stores base64 data URL. Stage 1 omits driver signature; stage 2 includes it.
- `CmrProcessor` (`cmr.processor.ts`): BullMQ processor on `cmr-generation` queue, reads `job.data.stage` and calls `cmrService.generateCmr(tripId, stage)`
- On-demand override: `POST /trips/:tripId/generate-cmr` (`@Roles(admin, dispatcher)`).

---

## Fleet Module (OTA) (`src/fleet/`)

Manages the device registry and over-the-air APK updates for the mobile fleet.

### Files

| File | Role |
|---|---|
| `fleet.controller.ts` | Public `POST /fleet/checkin` endpoint (`@Public()`, no auth) |
| `fleet-admin.controller.ts` | All super-admin endpoints under `/super-admin/` (`@Roles(super_admin)`) |
| `fleet.service.ts` | Business logic: check-in, HMAC verify, OTA state machine, APK upload, deployments |
| `fleet-push.service.ts` | Optional FCM data-push acceleration (dynamic import of `firebase-admin`) |
| `ota-deploy.processor.ts` | BullMQ processor for `ota-deploy` queue — activates scheduled deployments |

### Device check-in (`POST /fleet/checkin`)

Called by the mobile app on startup, foreground, and after sync. Uses `deviceCheckinSchema` from `@strawboss/validation`.

- **First call** (unknown `deviceUuid`): registers the device; returns a `deviceTokenIssued` (HMAC token) that the app must store and present on every subsequent call.
- **Returning device**: must supply `deviceToken`; verified with `timingSafeEqual(HMAC-SHA256(SUPABASE_JWT_SECRET, deviceUuid), token)`.
- **OTA reports**: the payload may include an `otaReports[]` array reporting the current state of one or more deployments (`downloading | downloaded | installing | installed | failed`). The anti-skew rule prevents false `installed` confirmations: if the device's reported `versionCode` is lower than the release's `versionCode`, the state is clamped to `installing`.
- **Command reports**: the payload may include a `commandReports[]` array (`[{ commandId, status: 'success' | 'failure', error? }]`) reporting the outcome of previously issued `DeviceCommand`s (e.g. Tailscale up/down). Applied before `pendingCommand` is computed. Success sets `tailscale_applied = tailscale_desired`; failure records `tailscale_last_error`.
- **Response**: `{ deviceId, assignedOrgId, deviceTokenIssued?, pendingDeployment?, pendingCommand? }`. `pendingDeployment` is non-null when there is an active deployment targeting this device that it has not yet installed. `pendingCommand` is non-null when `tailscale_desired <> tailscale_applied`; see [[backend#Tailscale remote-access control]].

### OTA state machine (`device_ota_status.state`)

States (enum `ota_state`): `pending → notified → downloading → downloaded → installing → installed | failed`

The state row is created with `pending` on deployment activation. It transitions to `notified` the first time the device checks in and receives the pending deployment. The device drives the remaining transitions via `otaReports[]`. `installed` is only accepted when the device's `versionCode >= release.versionCode` (anti-skew guard).

### APK upload

APKs are stored under `{UPLOADS_ROOT}/apks/{uuid}.apk`. SHA-256 is computed on ingest via a streaming pass. The global `@fastify/multipart` 3 MB limit is overridden per-request to 250 MB via `req.file({ limits: { fileSize: 250 * 1024 * 1024 } })`. APK download URLs are served as HMAC-signed URLs via the same `signUploadUrl` mechanism as other uploads.

### Deployment fan-out (`target_kind`)

`all` — every non-deleted device; `org` — devices in a specific `organization_id`; `device_set` — explicit UUID array.

On activation, `device_ota_status` rows are inserted for all matching target devices (devices already at or above the release `versionCode` are immediately marked `installed`). Devices not yet in the table are handled lazily on their next check-in.

### Scheduled deployments (`QUEUE_OTA_DEPLOY`)

When `createDeploymentSchema.scheduledAt` is set, a BullMQ delayed job is added with `delay = scheduledAt - now()` and `jobId = ota-deploy-{deploymentId}`. `OtaDeployProcessor` processes it by calling `FleetService.activateDeployment()`. Negative delay is clamped to 0.

### FCM acceleration push (`fleet-push.service.ts`)

`FleetPushService` sends a data-only FCM push (`type: ota_checkin`) after deployment activation to prompt devices to check in sooner than their normal poll interval. `firebase-admin` is **not** a hard dependency — it is dynamically imported via a non-literal specifier (`const pkg = 'firebase-admin'; await import(pkg)`). If the `FIREBASE_SERVICE_ACCOUNT` env var is absent or the package is unavailable, the service logs once at `info` and becomes a no-op. **Poll is the authoritative delivery mechanism.**

### Mobile log viewer (`GET /super-admin/devices/:id/logs`)

Reads Winston NDJSON log files under `logs/mobile/{level}/{YYYY-MM-DD}.log`, filters lines where `meta.deviceId` or top-level `deviceId` matches the device's `deviceUuid`. Returns the last 1000 matching lines. `date` must match `/^\d{4}-\d{2}-\d{2}$/` (path traversal guard). `level` is allow-listed to `all | error | warn | info | flow | debug | http`.

### Tailscale remote-access control

The fleet module implements a command-channel pattern so super-admins can toggle Tailscale on/off on individual devices without a persistent connection.

**Device fields** (columns on `devices`):

| Column | Type | Meaning |
|---|---|---|
| `tailscale_desired` | boolean | What the admin wants (toggled via `PATCH /super-admin/devices/:id/tailscale`) |
| `tailscale_applied` | boolean | What the device last successfully applied |
| `tailscale_online` | boolean | Whether Tailscale reports the device as online (updated by host sync script) |
| `tailscale_ip` | text | Tailscale IP address once connected |
| `tailscale_hostname` | text | Sanitized DNS label sent to the device in the `up` command |
| `tailscale_last_seen` | timestamptz | Last Tailscale heartbeat (from host sync) |
| `tailscale_last_error` | text | Last error message from a failed command |

**Command channel in check-in response**

`computePendingCommand(deviceId)` runs after OTA reports are applied. It issues a `DeviceCommand` only when `tailscale_desired <> tailscale_applied`:

- `action: 'down'` — returned immediately with no auth key; device runs `tailscale down`.
- `action: 'up'` — issued only to a device that has token-verified its `deviceToken` (the HMAC guard on check-in). Reads `app_settings` for Tailscale config, then:
  1. Calls `sanitizeHostname(device.name, deviceId)` — lowercases, replaces non-`[a-z0-9-]` runs with `-`, strips leading/trailing `-`; fallback `phone-<first-8-chars-of-deviceId>`.
  2. Eagerly writes `tailscale_hostname` to the DB so the host sync script can match the node.
  3. Calls `mintEphemeralAuthKey` if OAuth is configured (preferred); falls back to the shared `tailscale_auth_key` from `app_settings`.
  4. If no usable auth key exists at all, records `tailscale_last_error` and returns `null` (no command issued).
  5. Attaches a signed `tailscaleApk` URL + SHA-256 to the payload if `tailscale_apk_key` is set in `app_settings` (zero-touch install on Device-Owner phones).

The `DeviceCommand` returned in the check-in response carries a new `id` (`randomUUID()`) so the device can report back with `commandReports[{ commandId, status, error? }]`. On success, `tailscale_applied` is set to `tailscale_desired` and `tailscale_last_error` is cleared. On failure, only `tailscale_last_error` is updated.

**Ephemeral key minting (`mintEphemeralAuthKey`)**

Two sequential HTTP calls to the Tailscale API:

1. `POST https://api.tailscale.com/api/v2/oauth/token` with `grant_type=client_credentials` + `client_id` + `client_secret` → `access_token`.
2. `POST https://api.tailscale.com/api/v2/tailnet/-/keys` with `Authorization: Bearer <access_token>` → key with `capabilities.devices.create = { reusable: false, ephemeral: true, preauthorized: true, tags: [tag] }`, `expirySeconds: 3600`, `description: "fleet <hostname>"`.

Returns the `key` string or `null` on any error (network or non-2xx). The caller falls back to the shared `app_settings.tailscale_auth_key` if minting fails. OAuth minting requires `tailscale_oauth_client_id`, `tailscale_oauth_client_secret`, and `tailscale_tag` all to be configured in `app_settings`.

**APK hosting for zero-touch install**

`POST /super-admin/settings/tailscale-apk` stores the Tailscale APK at `{UPLOADS_ROOT}/tailscale/tailscale.apk`, records `tailscale_apk_key` and `tailscale_apk_sha256` in `app_settings`. When an `up` command is built, the payload includes `tailscaleApk: { url: <signed-URL>, sha256 }` if the APK is present. Device-Owner phones can silently install it before connecting.

**Global settings (`app_settings` singleton)**

`GET /super-admin/settings/tailscale` returns an `AppSettings` object. Secrets are **never** returned — they are masked to boolean flags (`tailscaleAuthKeySet`, `tailscaleOauthConfigured`). `PUT /super-admin/settings/tailscale` accepts partial updates via `updateTailscaleSettingsSchema`; send `''` to clear a secret field, omit the field to leave it unchanged.

### `MobileLogsService` change

`MobileLogsService.ingest(entries, userId, deviceId?)` now accepts an optional `deviceId` string and writes it into every Winston meta object. `MobileLogsController` reads `body.deviceId` from the ingest DTO and passes it through. This allows the log viewer above to correlate log lines to a specific registered device.

---

## Job Scheduler (`src/jobs/job-scheduler.service.ts`)

`JobSchedulerService` implements `OnModuleInit`. On startup, calls `upsertJobScheduler()` for 4 repeating jobs:

| Queue | Schedule | Purpose |
|---|---|---|
| `geofence-check` | every 5 min | `GeofenceProcessor` -- checks ST_Contains for all active assignments |
| `alert-evaluation` | every 15 min | `AlertsProcessor` -- checks odometer/GPS discrepancy + timing anomalies |
| `reconciliation` | every 60 min | `ReconciliationProcessor` -- bale count + fuel reconciliation |
| `sync-cleanup` | daily 02:00 (cron) | `SyncCleanupProcessor` -- purges idempotency records > 30 days |
| `truck-idle-check` | on-demand (queued after `start-loading`) | `TruckIdleProcessor` -- checks if truck has been idle > `STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN` (default 30 min); sends loader-recall push if so (Plan C) |
| `gps-retention` | daily 02:30 (cron) | `GpsRetentionProcessor` (`src/location/gps-retention.processor.ts`) -- retention/downsampling of `machine_location_events` (D1): batched-delete rows > 90 days; batched-downsample the 14–90 day window to 1 point/machine/minute (NULL-`machine_id` rows downsampled per-operator instead); each step capped at 50 batches of 20 000 rows per run so a first-time backlog is worked off over several nights instead of blocking |

The `cmr-generation` queue is on-demand only (triggered by trip completion or manual endpoint).

The `ota-deploy` queue uses **delayed jobs** (not repeating). Each job is added by `FleetService.createDeployment()` when `scheduledAt` is set; `OtaDeployProcessor` processes it by calling `FleetService.activateDeployment()`. Immediate deployments bypass the queue entirely.

---

## Swarm / Multi-Replica Safety

The backend runs as **2 Swarm replicas** (`backend` service in `docker-stack.yml`). The following mechanisms keep it correct under concurrent replicas and zero-downtime rolling deploys.

### Graceful shutdown (`main.ts`)

`app.enableShutdownHooks()` is enabled. Signal handlers for `SIGTERM` and `SIGINT` call `await app.close()`, which:

1. Stops accepting new HTTP requests (Fastify closes its listener).
2. Drains in-flight HTTP requests.
3. Fires `onModuleDestroy` on every module — closes BullMQ workers so active jobs finish before the process exits.

Paired with `stop_grace_period` in `docker-stack.yml`. The outgoing replica on a rolling deploy shuts down cleanly instead of dropping requests.

### Database connection pool (`drizzle.provider.ts`)

`DATABASE_URL` points at the **Supabase session-mode pooler** (one upstream server connection held per client connection). The pool is capped per replica:

- `max: 8` connections per replica
- `idle_timeout: 20` s
- `connect_timeout: 10` s

With 2 replicas: ~16 steady connections, ~24 peak during a rolling deploy (old + new replica both live). Stays within the pooler budget.

`DrizzleProvider.client` (the raw `ReturnType<typeof postgres>`) is also exposed publicly so modules that need a session-scoped pinned connection can call `.reserve()` on it directly.

### Boot backfill advisory lock (`trips.service.ts` `onModuleInit`)

The truck-task backfill that runs on every boot is guarded by a PostgreSQL advisory lock to prevent duplicate trip materialization when both replicas cold-start simultaneously:

1. Reserves a pinned connection via `drizzleProvider.client.reserve()`.
2. Calls `pg_try_advisory_lock(hashtext('strawboss:trip-backfill'))` on that connection.
3. If the lock is not acquired (another replica holds it), returns immediately — the other replica owns the backfill this boot.
4. Releases with `pg_advisory_unlock(...)` in `finally`, then calls `.release()` on the connection.

The lock is session-scoped and self-releases if the process dies. Does not fire on normal one-at-a-time rolling deploys (the old replica finishes before the new one boots).

### Already multi-instance-safe

| Mechanism | Why it is safe |
|---|---|
| BullMQ repeatable jobs | Seeded with stable scheduler IDs via `upsertJobScheduler()` — one job per interval across all replicas |
| BullMQ processors | Competing-consumer workers — only one replica processes each job |
| Redis-backed PIN throttle | Shared Redis state — rate limit is global, not per-replica |
| `sync_idempotency` table | Postgres-level dedup — duplicate sync pushes from mobile are idempotent |
| No in-memory pub/sub | No WebSocket or socket.io state — each request is stateless |

---

## Error Handling

### `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`)
Catches all exceptions. For `HttpException`, extracts status + message. Logs 5xx as `error`, 4xx as `warn`. Returns JSON: `{ statusCode, message, error, timestamp, requestId? }`.

### `LoggingInterceptor` (`src/common/interceptors/logging.interceptor.ts`)
Assigns `X-Request-Id` (from header or `randomUUID()`). Logs one line per request at Winston level `http` with: method, path, statusCode, durationMs, userId, ip.

### `ZodValidationPipe` (`src/common/pipes/zod-validation.pipe.ts`)
Wraps `schema.safeParse()`. Throws `BadRequestException` with flattened Zod errors on failure.

---

## Environment Variables

Required (validated in `src/config/env.validation.ts`):

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3001) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `SUPABASE_JWT_SECRET` | HS256 JWT signing secret |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis URL for BullMQ (default: `redis://localhost:6379`) |

Additional from `.env.example`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL for client-side (baked into Next.js build) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for client-side |
| `NEXT_PUBLIC_API_URL` | Public API URL for admin-web production build |
| `CORS_EXTRA_ORIGINS` | Comma-separated extra CORS origins |
| `LOG_ROOT` | Custom log directory (Docker: `/app/logs`) |
| `STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN` | Minutes before truck-idle BullMQ job fires a loader-recall push (default: 30, coerced int > 0) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON string of a Firebase service account credential (optional); enables FCM acceleration push for OTA deployments via `FleetPushService`; if absent, the service is a no-op and devices fall back to poll |
| `REDIS_PASSWORD` | Redis password for Docker Compose |
| `CERTBOT_EMAIL` | Let's Encrypt cert email |

---

## Related Docs

- [Admin Web](admin-web.md) -- consumes these endpoints via `@strawboss/api` hooks
- [Mobile App](mobile.md) -- uses sync/push, sync/pull, location/report, and notification endpoints
