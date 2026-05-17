---
name: strawboss-debug
description: Debug issues in StrawBoss -- sync problems, geofence, BullMQ, map, auth
---

# StrawBoss Debugging Playbooks

When diagnosing an issue, identify the category and follow the corresponding playbook. Read the relevant source files first before guessing.

---

## Sync not working

The mobile sync system uses a push/pull cycle managed by `SyncManager` (`apps/mobile/src/sync/SyncManager.ts`).

### Push side (mobile to server)

1. **Check sync queue status**: Look at `sync_queue` table in local SQLite. Entries have statuses: `pending`, `in_flight`, `completed`, `failed`.
   - Stuck `in_flight` entries: `SyncManager.sync()` calls `syncQueueRepo.resetInFlight()` at the start of each cycle, so these reset automatically. If they persist, the app may be crashing mid-sync.
   - `failed` entries: Check `last_error` column and `retry_count`.

2. **Check sync_idempotency on server**: The backend `sync.service.ts` checks `sync_idempotency` table before processing. If an entry exists with the same idempotency key, it returns the cached result. If the client thinks it failed but the server processed it, the data is actually there.
   - Query: `SELECT * FROM sync_idempotency WHERE idempotency_key = '<key>';`

3. **Check column allowlist**: `sync.service.ts` has `ALLOWED_COLUMNS` map. If a mutation includes a column not in the allowlist, it throws `BadRequestException`. Check that all columns in the mutation payload match the allowlist for that table.

4. **Check ownership scoping**: The sync push validates that the caller owns the record. If a driver tries to push a mutation for another driver's trip, it will be rejected.

5. **Check SYNCABLE_TABLES**: Only tables in the `SYNCABLE_TABLES` set can be synced: `trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `task_assignments`, `machines`, `parcels`.

### Pull side (server to mobile)

1. **Check sync_version**: Pull uses `POST /api/v1/sync/pull` with a `sync_version` per table. If the mobile sends version 0, it gets all records. If it sends a stale version, it gets the delta.
2. **Check merge logic**: `src/sync/conflict.ts` has `mergeRecords()` for conflict resolution. Server wins by default.

### Log commands
```bash
./strawboss.sh logs:flow    # Business transitions including sync events
./strawboss.sh logs:error   # Server errors
./strawboss.sh logs:mobile  # Mobile device logs uploaded after sync
```

---

## Geofence not firing

The geofence system runs as a BullMQ job every 5 minutes (`geofence-check` queue).

### Diagnosis steps

1. **Is the job scheduler running?** Check that `JobSchedulerService` in `backend/service/src/jobs/job-scheduler.service.ts` is in the providers of `JobsModule`. It seeds the repeating job on `onModuleInit`.
   ```bash
   ./strawboss.sh logs | grep -i "geofence\|JobScheduler"
   ```

2. **Is Redis connected?** BullMQ requires Redis. Check connection:
   ```bash
   docker exec -it $(docker ps -q -f name=redis) redis-cli -a "${REDIS_PASSWORD}" ping
   ```

3. **Does the machine have GPS data?** `GeofenceService.checkMachinePositions()` queries `machine_location_events` for the latest position per machine. If no recent GPS events exist, geofence checks silently skip.
   - Query: `SELECT * FROM machine_location_events WHERE machine_id = '<id>' ORDER BY recorded_at DESC LIMIT 5;`

4. **Is the parcel boundary valid?** PostGIS `ST_Contains` requires a valid polygon. Check:
   - Query: `SELECT ST_IsValid(boundary::geometry) FROM parcels WHERE id = '<id>';`
   - If invalid, the boundary GeoJSON may have self-intersections.

5. **Is the assignment active?** Geofence only checks machines with today's active assignments (`status IN ('available', 'in_progress')` and `deleted_at IS NULL`).

6. **Check for duplicate event suppression**: `GeofenceService` checks `machine_location_events` for the last event per machine+geofence pair to avoid duplicate enter/exit notifications. If the machine is already "inside," a new "entered" event will not fire.

### Key files
- `backend/service/src/geofence/geofence.service.ts` -- main check logic
- `backend/service/src/jobs/job-scheduler.service.ts` -- repeating job setup
- `backend/service/src/jobs/queues.ts` -- queue name constants

---

## Map blank or not loading

The admin dashboard map uses Leaflet via `LeafletMap.tsx` component.

### Diagnosis steps

1. **Check Leaflet CDN load**: The component loads Leaflet CSS/JS from CDN. If the CDN is blocked or slow, the map will be blank. Check browser devtools Network tab for failed requests to `unpkg.com/leaflet`.

2. **Check WebView bridge (mobile)**: The mobile app uses a WebView bridge for map rendering. Check `apps/mobile/src/map/` for the bridge implementation. Messages between React Native and the WebView can fail silently.

3. **Check parcels API response**: LeafletMap fetches parcels to render boundaries. If `/api/v1/parcels` returns an error or empty array, the map shows no polygons.
   - Use `normalizeList()` pattern -- the response could be `[]` or `{ data: [] }`.

4. **Check tile layer**: The map uses OpenStreetMap tiles by default. Corporate firewalls may block tile servers.

5. **Check browser console**: Leaflet errors appear in the browser console. Look for "Map container is already initialized" (double mount) or "Invalid LatLng" (bad coordinates).

### Key files
- `apps/admin-web/src/components/map/LeafletMap.tsx`
- `apps/mobile/src/map/`

---

## Auth rejected (401/403)

Authentication uses Supabase JWTs verified in `backend/service/src/auth/auth.guard.ts`.

### 401 Unauthorized

1. **Check JWT expiry**: Decode the token at jwt.io. Supabase tokens expire after 1 hour by default. The frontend must refresh via `supabase.auth.getSession()`.

2. **Check algorithm**: `AuthGuard` supports both HS256 (legacy) and ES256/RS256 (modern JWKS). If the token uses an unexpected algorithm, verification fails.

3. **Check SUPABASE_JWT_SECRET**: For HS256 tokens, the backend verifies with `SUPABASE_JWT_SECRET` env var. If this doesn't match the Supabase project secret, all tokens are rejected.

4. **Check Authorization header format**: Must be `Bearer <token>`. Missing "Bearer " prefix causes immediate rejection.

### 403 Forbidden

1. **Check role in JWT**: The role is extracted from `app_metadata.role` (modern) or `user_role`/`role` (legacy). Decode the token and verify the role field exists.

2. **Check @Roles on endpoint**: The `RolesGuard` in `auth/roles.guard.ts` reads the `@Roles(...)` decorator. If the user's role is not in the allowed list, it returns 403.

3. **Check @Public if needed**: Endpoints that should be unauthenticated (health check, login) must have `@Public()` decorator. Without it, the global `AuthGuard` rejects requests without a token.

### Key files
- `backend/service/src/auth/auth.guard.ts` -- JWT verification, `@Public()` decorator
- `backend/service/src/auth/roles.guard.ts` -- `@Roles()` decorator and guard
- `backend/service/src/auth/current-user.decorator.ts` -- `@CurrentUser()` parameter decorator

---

## BullMQ jobs not running

BullMQ queues are defined in `backend/service/src/jobs/queues.ts`. Repeating jobs are seeded by `JobSchedulerService`.

### Diagnosis steps

1. **Check Redis connection**: All BullMQ queues need Redis. The connection URL is `REDIS_URL` env var. In Docker: `redis://:${REDIS_PASSWORD}@redis:6379`.
   ```bash
   ./strawboss.sh logs | grep -i "redis\|bullmq\|ECONNREFUSED"
   ```

2. **Check JobSchedulerService is registered**: It must be in the `providers` array of `JobsModule` (`jobs.module.ts`). It implements `OnModuleInit` and seeds jobs on startup.

3. **Check processor is registered**: Each queue needs a `@Processor(QUEUE_NAME)` class. Look for files matching `*.processor.ts` in the relevant module directory.

4. **Check job scheduler logs**: On startup, `JobSchedulerService` logs:
   ```
   Seeding repeating BullMQ jobs...
   Repeating jobs seeded: geofence (5m), alerts (15m), reconciliation (1h), sync-cleanup (daily 02:00)
   ```
   If these messages are missing, the service didn't initialize.

5. **Check queue names match**: The queue name in `@Processor()` must exactly match the constant in `queues.ts`:
   - `alert-evaluation` (15 min)
   - `reconciliation` (1 hour)
   - `cmr-generation` (on-demand)
   - `sync-cleanup` (daily 02:00)
   - `geofence-check` (5 min)

### Key files
- `backend/service/src/jobs/queues.ts` -- queue name constants
- `backend/service/src/jobs/job-scheduler.service.ts` -- repeating job seeder
- `backend/service/src/jobs/jobs.module.ts` -- module registration
- `backend/service/src/sync/sync-cleanup.processor.ts` -- example processor

---

## How to read logs

StrawBoss uses structured Winston logging with daily rotation.

```bash
# All logs (combined) -- JSON lines, most recent
./strawboss.sh logs

# Error-level only
./strawboss.sh logs:error

# Business flow transitions (trip state changes, sync events, geofence events, task assignments)
./strawboss.sh logs:flow

# Mobile device logs (uploaded from phones after sync)
./strawboss.sh logs:mobile

# Clean all log files
./strawboss.sh logs:clean
```

### Log file layout
```
logs/
  web/
    all/YYYY-MM-DD.log          # Combined all-level
    error/YYYY-MM-DD.log        # Error only
    warn/YYYY-MM-DD.log         # Warnings
    info/YYYY-MM-DD.log         # Info
    debug/YYYY-MM-DD.log        # Debug
    flow/YYYY-MM-DD.log         # Business transitions
    http/YYYY-MM-DD.log         # HTTP request/response (with X-Request-Id)
  mobile/
    all/YYYY-MM-DD.log          # Uploaded mobile NDJSON
```

### Tips
- Correlate requests using `X-Request-Id` header (logged by `LoggingInterceptor`).
- Flow logs are the most useful for business issues -- they record trip state transitions, geofence events, and sync activity.
- Mobile logs are only available after a successful sync uploads them.
- Files auto-prune after 7 days (`maxFiles: '7d'` in Winston config).
