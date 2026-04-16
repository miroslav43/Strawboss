# Offline Sync Protocol

The mobile app (`apps/mobile`) is offline-first: all writes go to local SQLite, then sync to the server when online. The backend (`backend/service/src/sync/`) processes mutations with idempotency guarantees.

## Architecture Overview

```
Mobile (SQLite)                          Backend (PostgreSQL)
  |                                        |
  |  local write -> sync_queue             |
  |  (outbox pattern)                      |
  |                                        |
  |------ POST /api/v1/sync/push -------->|  idempotency check
  |<----- SyncResponse -------------------| apply mutation
  |                                        |  record in sync_idempotency
  |------ POST /api/v1/sync/pull -------->|  delta query (sync_version > N)
  |<----- SyncResponse -------------------| merge into local SQLite
  |                                        |
  | (on success, upload mobile logs)       |
```

## Sync Queue (Mobile Side)

**Source:** `apps/mobile/src/db/sync-queue-repo.ts`

### SQLite Table: `sync_queue`

| Column | Type | Purpose |
|---|---|---|
| `id` | INTEGER PK | Auto-increment row id |
| `entity_type` | TEXT | Table name (e.g., `trips`, `fuel_logs`) |
| `entity_id` | TEXT | UUID of the record |
| `action` | TEXT | `insert`, `update`, or `delete` |
| `payload` | TEXT | JSON-serialized mutation data |
| `idempotency_key` | TEXT | UUID v4, unique per mutation |
| `status` | TEXT | `pending`, `in_flight`, `completed`, `failed` |
| `retry_count` | INTEGER | Incremented on failure |
| `last_error` | TEXT | Last error message |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### Status Lifecycle

```
pending -> in_flight -> completed
                    \-> failed -> pending (retry)
```

### Outbox Pattern (`sync/outbox.ts`)

`createOutboxEntry(entityType, entityId, action, payload)` generates an `OutboxEntry` with a UUID v4 `idempotencyKey`. Every local write creates an outbox entry that is enqueued into `sync_queue`.

## Push Flow (`sync/push.ts`)

`pushMutations(entries: SyncQueueEntry[], apiClient: ApiClient): PushResult`

1. `SyncManager.push()` calls `syncQueueRepo.dequeue(50)` to get up to 50 pending entries.
2. Marks them `in_flight` via `syncQueueRepo.markInFlight(ids)`.
3. Converts entries to `SyncPushRequest.mutations[]` format (table, recordId, action, data, clientId, clientVersion, idempotencyKey).
4. POSTs to `POST /api/v1/sync/push`.
5. For each result:
   - `applied` or `skipped` -> marks `completed`.
   - `conflict` -> marks `failed` with error message.
6. Entries without a server response (truncated) are marked `failed`.

## Push Processing (Server Side)

**Source:** `backend/service/src/sync/sync.service.ts`

### Syncable Tables

`trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `task_assignments`, `machines`, `parcels`.

### Column Allowlist

Each table has an explicit set of allowed column names in `ALLOWED_COLUMNS`. `validateColumnName()` rejects any column not in the allowlist, preventing SQL injection via `sql.raw()`.

### Processing Steps (per mutation)

1. **Idempotency check**: Query `sync_idempotency` for `(clientId, table, recordId, clientVersion)`. If found, return `status: 'skipped'` with cached `serverVersion`.

2. **Apply mutation**:
   - `insert`: Sets `sync_version = 1`, validates all column names, inserts with `RETURNING *`.
   - `update`: Reads current `sync_version`, increments it, validates column names, updates with `RETURNING *`. Skips `id`, `sync_version`, and `updated_at` from the data payload.
   - `delete`: Soft-delete (`SET deleted_at = NOW()`) with incremented `sync_version`.

3. **Record idempotency**: Insert into `sync_idempotency` with the server version and result data.

4. **Return**: `{ table, recordId, status: 'applied', serverVersion, data }`.

## Pull Flow (`sync/pull.ts`)

`pullUpdates(lastVersions: Record<string, number>, apiClient: ApiClient): PullResult`

1. `SyncManager.getLastVersions()` queries each local repo for `getMaxServerVersion()` across synced tables: `trips`, `bale_productions`, `fuel_logs`, `consumable_logs`, `bale_loads`, `task_assignments`.

2. POSTs to `POST /api/v1/sync/pull` with `{ tables: { trips: 5, fuel_logs: 3, ... } }`.

3. Server queries each syncable table: `WHERE sync_version > sinceVersion` with user-scoped filtering:
   - `trips`: `driver_id = callerId OR loader_operator_id = callerId`
   - `bale_productions`, `fuel_logs`, `consumable_logs`, `bale_loads`: `operator_id = callerId`
   - Limit 1000 rows per table, ordered by `sync_version ASC`.

4. Returns `{ deltas: { trips: [...], ... }, serverTime }`.

## Conflict Resolution (`sync/conflict.ts`)

`mergeRecords(table, recordId, localRecord, serverRecord): Record<string, unknown>`

**Strategy**: Field-level merge with server-wins default.

Server always wins for these authoritative fields:
- `status` (state machine authority)
- `bale_count` (aggregate count)
- `sync_version` / `server_version` (monotonically increasing)
- `completed_at`, `cancelled_at`, `cancellation_reason`

For all other fields, server also currently wins (conservative default to prevent data divergence). Future enhancement: compare `updated_at` timestamps for true last-write-wins on non-critical fields.

### Merge Process

For each field in the server record:
1. If local and server values are identical (JSON.stringify comparison), skip.
2. Call `resolveConflict()` to determine winner.
3. If server wins, overwrite local value.
4. Return merged record.

## Crash Recovery

**Source:** `SyncManager.sync()` in `apps/mobile/src/sync/SyncManager.ts`

At the start of every sync cycle, `syncQueueRepo.resetInFlight()` resets any entries stuck in `in_flight` back to `pending`. This handles the case where the app crashed or was killed during a push -- those mutations will be retried on the next sync.

## Sync Triggers

The mobile app triggers sync on:
- App foreground
- Network reconnect
- After local write (2s debounce)
- Periodic 60s interval

## Mobile Log Upload

After a successful sync cycle (zero errors), `uploadTodayMobileLogs()` uploads today's NDJSON log file to `POST /api/v1/logs/mobile` and deletes local day files for all categories (`all`, `error`, `warn`, `info`, `flow`, `debug`).

**Source:** `apps/mobile/src/sync/mobile-log-upload.ts`

## Sync Cleanup (Server)

**Source:** `backend/service/src/sync/sync-cleanup.processor.ts`

BullMQ job (`sync-cleanup` queue, runs daily at 02:00) deletes `sync_idempotency` records older than 30 days:

```sql
DELETE FROM sync_idempotency WHERE processed_at < NOW() - INTERVAL '30 days'
```

## Sync Status Endpoint

`GET /api/v1/sync/status` returns the last processed version per table for the authenticated user, queried from `sync_idempotency`.
