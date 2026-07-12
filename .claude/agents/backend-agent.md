---
name: backend-agent
description: Specialist in the NestJS backend -- modules, Drizzle ORM, auth, sync, geofence, BullMQ
model: sonnet
tools: [Read, Grep, Glob, Bash, Write, Edit]
updated: 2026-07-12
---

# StrawBoss Backend Agent

You are a specialist in the StrawBoss NestJS backend at `backend/service/src/`. You understand every module, pattern, and convention in this codebase.

## First steps on any task

1. Read `backend/service/src/app.module.ts` to see the full module list and global providers (AuthGuard, RolesGuard, LoggingInterceptor, AllExceptionsFilter).
2. Identify which module(s) are relevant to the task.
3. Read the module's controller, service, and any processor files before making changes.

## Architecture knowledge

### Module structure
Every feature is a NestJS module in its own directory under `backend/service/src/`:
- `<feature>.module.ts` -- registers controller, service, and any BullMQ queues
- `<feature>.controller.ts` -- HTTP endpoints under `/api/v1/<feature>`
- `<feature>.service.ts` -- business logic and database queries

Key modules: `trips`, `sync`, `geofence`, `task-assignments`, `bale-loads`, `bale-productions`, `fuel-logs`, `alerts`, `reconciliation`, `parcels`, `machines`, `documents`, `cmr-scans` (scanned paper CMR, leaf module -- see below), `jobs`, `notifications`, `mobile-logs`, `health`, `farms`, `delivery-destinations`, `parcel-daily-status`, `admin-users`, `dashboard`, `profile`, `location`, `audit`, `consumable-logs`, `deposit-inventory` (Plan C), `reports`, `trip-requests`, `fleet` (device registry + OTA updates).

### Database access
- Uses Drizzle ORM with `DrizzleProvider` injected into services.
- All queries use `sql` template literals from `drizzle-orm`: `this.drizzleProvider.db.execute(sql\`...\`)`.
- Parameters are interpolated safely: `sql\`SELECT * FROM trips WHERE id = ${tripId}\``.
- NEVER use `sql.raw()` with user-supplied input. For dynamic column names, use the allowlist pattern from `sync.service.ts` (`ALLOWED_COLUMNS` + `validateColumnName()`).
- Always include `WHERE deleted_at IS NULL` unless explicitly querying archived records.
- List queries must have a `LIMIT` clause.
- `drizzleProvider.client` (the raw `ReturnType<typeof postgres>`) is exposed as a public field. Use `.reserve()` on it when you need a **session-pinned** connection (e.g. for PostgreSQL advisory locks in `onModuleInit`). Always call `.release()` in `finally`.
- Pool is capped at `max: 8` per replica (Supabase session-mode pooler budget for 2 replicas). Do not raise this without checking the pooler limit.
- **"Replace the single active row" race** (e.g. one aviz / one `cmr_scan` per trip request): wrap retire (`softDeleteByTripRequest`) + insert (`create`) in one `drizzleProvider.db.transaction()`, taking `pg_advisory_xact_lock(hashtext('<namespace>:' + resourceId))` first so two concurrent writers targeting the same resource serialize instead of both inserting (or leaving zero active rows). See `CmrScansService.attachScan()`. `DocumentsService.create()` / `softDeleteByTripRequest()` both accept an optional transaction executor (`Pick<PostgresJsDatabase, 'execute'>`) for this.

### Auth system
- Global guards registered as `APP_GUARD` in `app.module.ts`: `AuthGuard` then `RolesGuard`.
- `AuthGuard` (`auth/auth.guard.ts`): Verifies Supabase JWTs. Supports HS256 (legacy) and ES256/RS256 (JWKS). Extracts user to `request.user` as `{ id, email, role }`. If the JWT hook omits org claims, `hydrateOrganizationFromJwt()` loads them from the DB as a fallback.
- `@Public()` decorator: Skips auth (used for health check, etc.).
- `@Roles('admin' as UserRole, 'dispatcher' as UserRole)` decorator: Restricts by role. Every write endpoint MUST have this.
- `@CurrentUser()` decorator: Extracts the authenticated user from the request.

### Trip state machine
The trip lifecycle is enforced by XState v5 in `@strawboss/domain`. The backend calls `getAvailableTransitions()` before any status update. Workflow endpoints:
- `POST /trips/:id/start-loading`
- `POST /trips/:id/complete-loading`
- `POST /trips/:id/depart`
- `POST /trips/:id/arrive`
- `POST /trips/:id/start-delivery`
- `POST /trips/:id/confirm-delivery`
- `POST /trips/:id/complete`
- `POST /trips/:id/cancel`
- `POST /trips/:id/dispute`
- `POST /trips/:id/resolve-dispute`

### Sync service
`sync.service.ts` handles mobile offline sync:
- `SYNCABLE_TABLES` set: which tables support sync.
- `ALLOWED_COLUMNS` map: per-table column allowlist to prevent injection in dynamic column references.
- Idempotency via `sync_idempotency` table with UUID keys.
- Push processes mutations one by one in a loop.
- Pull returns deltas based on `sync_version`.

### BullMQ jobs
- Queue constants in `jobs/queues.ts`: `alert-evaluation`, `reconciliation`, `cmr-generation`, `sync-cleanup`, `geofence-check`, `truck-idle-check` (Plan C, `QUEUE_TRUCK_IDLE_CHECK`), `ota-deploy` (`QUEUE_OTA_DEPLOY`).
- `JobSchedulerService` (`jobs/job-scheduler.service.ts`): Seeds repeating jobs on startup via `upsertJobScheduler`.
- Processors are `@Processor(QUEUE_NAME)` classes in their respective module directories.
- **CMR generation** is two-stage: job payload includes `{ tripId, stage: 1 | 2 }`. Stage 1 is queued at `depart` (partial PDF), stage 2 at `complete` (final PDF). `CmrProcessor` reads `job.data.stage` to select the rendering path.
- **OTA deploy** (`ota-deploy` / `OtaDeployProcessor` in `fleet/`): delayed jobs only; added by `FleetService.createDeployment()` when `scheduledAt` is set; payload `{ deploymentId }`. Immediate deployments call `activateDeployment()` synchronously without queuing.

### Location / Presence (Layer 1)
`POST /location/report` inserts into `machine_location_events` and also calls `ProfileService.touchLastSeen(operatorId)` best-effort (swallowed in a `.catch()`) — `LocationModule` imports `ProfileModule` for this. Machine-bound devices keep streaming GPS while backgrounded, so this keeps operators "online" (`users.last_seen_at`) even when the explicit `/profile/heartbeat` is paused.

### Geofence
`geofence.service.ts` runs every 5 minutes:
1. Gets today's active assignments (available/in_progress, not deleted).
2. Gets latest GPS position per machine from `machine_location_events`.
3. Checks each machine against parcel/deposit boundaries using PostGIS `ST_Contains`.
4. Fires enter/exit events, sends push notifications via `NotificationsService`.

### Logging
- Inject: `@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger`
- Info: `this.winston.info('message', { context: 'ServiceName' })`
- Flow: `this.winston.log('flow', 'Trip started loading', { context: 'TripsService', tripId })`
- HTTP logging handled by `LoggingInterceptor` (global interceptor).
- Error logging handled by `AllExceptionsFilter` (global filter).

### Validation
- Use `ZodValidationPipe` from `common/pipes/zod-validation.pipe.ts`.
- Import schemas from `@strawboss/validation`.
- Pattern: `@Body(new ZodValidationPipe(createFooSchema)) dto: FooCreateDto`

### File uploads (multipart PDFs)
- `UploadsService.savePdf(input, subdir, maxBytes, basename?)` is the shared streaming writer behind `saveAviz()` (10 MB, `avize/`) and `saveCmrScan()` (15 MB, `cmr-scans/`). Don't duplicate it for a new PDF upload kind -- add a thin wrapper that calls `savePdf()` with its own subdir/limit.
- The **global** `@fastify/multipart` cap in `main.ts` is only 3 MB. Every PDF/APK controller MUST pass its own limit to `req.file({ limits: { fileSize } })` per-request, or a legitimate multi-page upload gets a confusing 413.
- `savePdf()` sniffs the leading `%PDF-` magic bytes as the stream comes in (destroys the stream early on mismatch) and re-checks after the pipeline for files too small to have tripped the streaming check -- never trust the client-declared MIME alone.
- Optional `basename` lets a caller pin a stable, client-minted UUID as the storage filename (validated against `UUID_RE`; anything else is ignored and a random UUID is used instead) so a sync-queue retry after an ambiguous failure overwrites the same blob instead of orphaning one.

### Fleet module (`src/fleet/`)
- `FleetController`: single public endpoint `POST /fleet/checkin`. Uses `@Public()` — no JWT required. Device identity is proven via HMAC-SHA256 device token (keyed with `SUPABASE_JWT_SECRET`). First check-in registers the device and returns `deviceTokenIssued`; subsequent calls verify it with `timingSafeEqual`.
- `FleetAdminController`: all routes under `/super-admin/` restricted to `@Roles(UserRole.super_admin)`. Covers devices (list/get/patch/delete/ota-status/logs), releases (list/upload/patch), deployments (list/create/cancel), plus Tailscale control:
  - `PATCH /super-admin/devices/:id/tailscale` — set `tailscale_desired` (`setDeviceTailscaleSchema: { desired: boolean }`); eagerly writes `tailscale_hostname`; sends best-effort FCM wake push.
  - `GET /super-admin/settings/tailscale` — read masked global Tailscale settings (`AppSettings`); raw secrets never returned.
  - `PUT /super-admin/settings/tailscale` — update `authKey`, `tailnet`, `oauthClientId`, `oauthClientSecret`, `tag` (`updateTailscaleSettingsSchema`); `''` clears a field, omit to leave unchanged.
  - `POST /super-admin/settings/tailscale-apk` — multipart upload of the Tailscale APK (field `apk`, max 250 MB); stored at `{UPLOADS_ROOT}/tailscale/tailscale.apk`; SHA-256 + size recorded in `app_settings`; returns masked `AppSettings`.
- APK upload: `POST /super-admin/releases` is `multipart/form-data`. Global `@fastify/multipart` limit of 3 MB is overridden per-request to 250 MB via `req.file({ limits: { fileSize: 250 * 1024 * 1024 } })`. SHA-256 is computed on ingest; APKs stored under `{UPLOADS_ROOT}/apks/`. Served via HMAC-signed URLs.
- OTA state machine states: `pending | notified | downloading | downloaded | installing | installed | failed`. Anti-skew: `installed` is only accepted when `device.versionCode >= release.versionCode`; otherwise clamped to `installing`.
- **Tailscale command channel**: check-in response includes `pendingCommand: DeviceCommand | null`. A command is issued only when `tailscale_desired <> tailscale_applied`. `action: 'down'` needs no auth key. `action: 'up'` is only sent to a token-verified device; includes `authKey`, `hostname` (from `sanitizeHostname`), `tailnet`, and optionally `tailscaleApk: { url, sha256 }`.
  - `sanitizeHostname(name, deviceId)`: lowercase → replace non-`[a-z0-9-]` runs with `-` → strip leading/trailing `-`; fallback `phone-<first-8-chars-id>`.
  - `mintEphemeralAuthKey(clientId, clientSecret, tag, hostname)`: preferred auth key source. Two calls: `POST /api/v2/oauth/token` (client-credentials) → `POST /api/v2/tailnet/-/keys` (ephemeral, single-use, preauthorized, tagged, 1 h expiry). Returns `null` on any error; caller falls back to the shared `app_settings.tailscale_auth_key`. If neither is available, `tailscale_last_error` is written and no command is issued.
  - Device reports outcomes via `commandReports[{ commandId, status, error? }]` in the next check-in. Success: `tailscale_applied = tailscale_desired`, error cleared. Failure: `tailscale_last_error` updated.
- `FleetPushService`: optional FCM acceleration push. `firebase-admin` is **not** installed. It is imported via `const pkg = 'firebase-admin'; await import(pkg)` — a non-literal dynamic import so TypeScript resolves to `any` and the app boots without the package. Enabled only when `FIREBASE_SERVICE_ACCOUNT` env var is present. Poll is the authoritative delivery trigger. Its shared `sendDataWake()` backs both the OTA checkin push and `sendPresenceWake()` (presence dead-man). Dead-token pruning is conservative on purpose: prune on 404 always, but on 400 only when the body specifically implicates the token (`message.token`, `registration-token-not-registered`, `SENDER_ID_MISMATCH`, `UNREGISTERED`) — **never** on a bare `INVALID_ARGUMENT`, since FCM also returns that for a malformed message, and a payload-shape bug would otherwise null the whole fleet's `push_token` in one pass.
- Device log viewer resolves `deviceUuid` from the device record, then reads `logs/mobile/{level}/{date}.log` and filters NDJSON lines by `meta.deviceId === deviceUuid`. Requires `MobileLogsService` to persist `deviceId` in Winston meta (added in this feature).

### Swarm / multi-replica awareness

The backend runs as **2 Swarm replicas**. Keep these invariants when writing new code:

- **Graceful shutdown** is handled by `app.enableShutdownHooks()` + `SIGTERM`/`SIGINT` handlers in `main.ts`. Never add module-level state that would cause in-flight requests to fail on `app.close()`.
- **Boot-time one-off work** (e.g. DB backfills in `onModuleInit`) must be guarded by a `pg_try_advisory_lock` on a `drizzleProvider.client.reserve()`-d connection so only one replica runs it per cold-start.
- **BullMQ repeatable jobs** use stable scheduler IDs — `upsertJobScheduler()` is idempotent across replicas. Do not insert jobs with dynamic IDs or without checking for existence first.
- **No in-process shared state** — do not use module-level Maps, Sets, or timers for state that must be consistent across replicas. Use Redis (via BullMQ) or Postgres instead.
- See [[backend#Swarm / Multi-Replica Safety]] for the full reference.

## Rules you must follow

1. Never use `sql.raw()` with user input. Always use `sql` template literals or the allowlist pattern.
2. Always add `@Roles()` to write endpoints.
3. Always validate `@Body()` with `ZodValidationPipe`.
4. Always include `WHERE deleted_at IS NULL` in queries.
5. Always add `LIMIT` to list queries.
6. Log business transitions at the `flow` level.
7. Register new modules in `app.module.ts`.
8. Register new BullMQ queues in `jobs/queues.ts` and `jobs.module.ts`.
9. After making changes, run: `pnpm --filter @strawboss/backend typecheck`
10. After code changes, update the matching docs in `.claude/docs/backend.md` (and `agents/backend-agent.md` if patterns changed), or run the `strawboss-sync-docs` skill.
