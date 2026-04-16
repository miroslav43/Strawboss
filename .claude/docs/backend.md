# Backend Service (`backend/service`)

NestJS 11 + Fastify 5 REST API. All routes under `/api/v1/`. Database access via Drizzle ORM + postgres.js. Background jobs via BullMQ + Redis.

Entry point: `backend/service/src/main.ts` -- boots a `NestFastifyApplication`, sets global prefix `api/v1`, configures CORS, listens on `PORT` (default 3001).

---

## Module Structure

The `AppModule` (`src/app.module.ts`) imports 28 feature modules:

| Module | Path | Purpose |
|---|---|---|
| `AppLoggerModule` | `src/logger/logger.module.ts` | Winston factory with daily-rotate-file transports (`logs/web/{all,error,warn,info,flow,http,debug}/`) |
| `HealthModule` | `src/health/` | Public liveness endpoint |
| `ConfigModule` | `src/config/config.module.ts` | `@nestjs/config` with Zod env validation (`src/config/env.validation.ts`) |
| `DatabaseModule` | `src/database/database.module.ts` | `DrizzleProvider` -- singleton postgres.js + Drizzle ORM connection |
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
| `MobileLogsModule` | `src/mobile-logs/` | Ingest batched NDJSON log entries from mobile devices |

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
- `POST /trips/:id/complete-loading` -- @Roles(admin, loader_operator) -- loading -> loaded (validates bale_loads > 0)
- `POST /trips/:id/depart` -- @Roles(admin, driver) -- loaded -> in_transit (records departure odometer)
- `POST /trips/:id/arrive` -- @Roles(admin, driver) -- in_transit -> arrived (calculates odometer distance)
- `POST /trips/:id/start-delivery` -- @Roles(admin, driver) -- arrived -> delivering
- `POST /trips/:id/confirm-delivery` -- @Roles(admin, driver) -- delivering -> delivered (records gross weight, computes net from truck tare)
- `POST /trips/:id/complete` -- @Roles(admin, driver) -- delivered -> completed (records receiver signature, auto-queues CMR generation)
- `POST /trips/:id/cancel` -- @Roles(admin) -- any pre-completed -> cancelled
- `POST /trips/:id/dispute` -- @Roles(admin) -- delivered -> disputed
- `POST /trips/:id/resolve-dispute` -- @Roles(admin) -- disputed -> completed or delivered

### CMR (`src/documents/cmr/cmr.controller.ts`)
- `POST /trips/:tripId/generate-cmr` -- @Roles(admin, dispatcher) -- on-demand CMR PDF generation

### Sync (`src/sync/sync.controller.ts`)
- `POST /sync/push` -- any authenticated -- push offline mutations (insert/update/delete) with idempotency
- `POST /sync/pull` -- any authenticated -- delta pull (records with sync_version > requested)
- `GET /sync/status` -- any authenticated -- last processed version per table for client

### Location (`src/location/location.controller.ts`)
- `POST /location/report` -- any authenticated -- store GPS ping (lat, lon, accuracy, heading, speed)
- `GET /location/machines` -- @Roles(admin) -- last known position of all machines (JOIN with users)
- `GET /location/related-machines` -- any authenticated -- positions of machines sharing today's assignments (siblings via parent_assignment_id)
- `GET /location/machines/:machineId/route?from=...&to=...` -- @Roles(admin) -- GPS route history (up to 50,000 points)

### Profile (`src/profile/profile.controller.ts`)
- `GET /profile` -- any authenticated -- current user's profile
- `PATCH /profile` -- any authenticated -- update fullName, phone, locale, notificationPrefs
- `POST /profile/change-password` -- any authenticated -- change password

### Notifications (`src/notifications/notifications.controller.ts`)
- `POST /notifications/register-token` -- any authenticated -- register/update Expo push token
- `POST /notifications/confirm-parcel-done` -- @Roles(admin, baler_operator) -- mark assignment done + record bale production

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

- `CmrService` (`cmr.service.ts`): loads `cmr.hbs` Handlebars template at construction. `generateCmr(tripId)` fetches trip + parcel + truck + driver + bale_loads, renders HTML, converts to PDF via Puppeteer (`headless: true, --no-sandbox`), stores base64 data URL
- `CmrProcessor` (`cmr.processor.ts`): BullMQ processor on `cmr-generation` queue, calls `cmrService.generateCmr()`
- Auto-trigger: `TripsService.complete()` adds a job to the CMR queue after marking trip completed

---

## Job Scheduler (`src/jobs/job-scheduler.service.ts`)

`JobSchedulerService` implements `OnModuleInit`. On startup, calls `upsertJobScheduler()` for 4 repeating jobs:

| Queue | Schedule | Purpose |
|---|---|---|
| `geofence-check` | every 5 min | `GeofenceProcessor` -- checks ST_Contains for all active assignments |
| `alert-evaluation` | every 15 min | `AlertsProcessor` -- checks odometer/GPS discrepancy + timing anomalies |
| `reconciliation` | every 60 min | `ReconciliationProcessor` -- bale count + fuel reconciliation |
| `sync-cleanup` | daily 02:00 (cron) | `SyncCleanupProcessor` -- purges idempotency records > 30 days |

The `cmr-generation` queue is on-demand only (triggered by trip completion or manual endpoint).

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
| `REDIS_PASSWORD` | Redis password for Docker Compose |
| `CERTBOT_EMAIL` | Let's Encrypt cert email |

---

## Related Docs

- [Admin Web](admin-web.md) -- consumes these endpoints via `@strawboss/api` hooks
- [Mobile App](mobile.md) -- uses sync/push, sync/pull, location/report, and notification endpoints
