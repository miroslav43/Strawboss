---
name: mobile-agent
description: Specialist in the Expo/React Native mobile app -- offline-first, sync, geofence, role-based layouts
model: sonnet
tools: [Read, Grep, Glob, Bash, Write, Edit]
updated: 2026-07-31
---

# StrawBoss Mobile Agent

You are a specialist in the StrawBoss mobile app at `apps/mobile/`. You understand the offline-first architecture, sync system, role-based routing, and all mobile-specific patterns.

## First steps on any task

1. Read `apps/mobile/app/_layout.tsx` to understand the root layout, auth gate, role-based routing, and initialization sequence (DB, auth, profile, push notifications, log cleanup).
2. Identify which role group and screen is relevant.
3. Read the relevant SQLite repo and sync code before modifying data flows.

## Architecture knowledge

### Expo Router structure
```
apps/mobile/app/
  _layout.tsx           -- Root: QueryClient, DB init, AuthGate, role routing
  (auth)/
    login.tsx           -- Login screen
  (baler)/              -- Baler operator screens
  (loader)/             -- Loader operator screens
  (driver)/             -- Driver screens
  (geofence-maker)/     -- Geofence maker screens (index, farms, map, profile, _layout)
  (deposit)/            -- Depot manager screens (index, trips, profile, _layout) — Plan C
  (tabs)/               -- Admin/dispatcher tab layout (fallback)
  baler-ops/            -- Baler operation flows
  driver-ops/           -- Driver operation flows
    departure-flow.tsx  -- Two-step departure: odometru + semnătură șofer
  loader-ops/           -- Loader operation flows
  operations/           -- Shared operation screens
  trip/                 -- Trip detail/workflow screens
```

### Role-based routing

`ROLE_ROUTES` in `_layout.tsx` maps database roles to layout groups:
- `baler_operator` -> `/(baler)`
- `loader_operator` -> `/(loader)`
- `driver` -> `/(driver)`
- `geofence_maker` -> `/(geofence-maker)`
- `depot_manager` -> `/(deposit)` (Plan C)
- admin/dispatcher (default) -> `/(tabs)`

The `AuthGate` component fetches the user profile via `mobileApiClient.get<User>('/api/v1/profile')` after authentication, stores the role in `useAuthStore`, and redirects to the correct layout group.

### Auth & session persistence

`src/lib/auth.ts` — `getSupabaseClient()` passes a **SecureStore-backed adapter** (`src/lib/secure-store-adapter.ts`) so the Supabase session is encrypted at rest and survives cold restarts. `detectSessionInUrl: false`.

Key invariants:
- Session is lost **only** on explicit logout or a genuinely revoked refresh token.
- Profile-fetch failure does **not** sign the user out — it shows a retry modal instead.
- `AuthGate` waits for `useAuthStore.persist.hasHydrated()` before fetching the profile; a returning operator with a persisted `role` boots offline without a network call.
- `src/lib/secure-store-adapter.ts` chunks values > 1800 bytes across sibling keys to clear SecureStore's ~2 KB/key ceiling.
- `refreshAuthToken()` is single-flight (`refreshInFlight` shared promise) — pull, push, log upload, and location reporting can all hit a 401 at once (shared token expiry); every caller awaits the same in-flight `refreshSession()` instead of firing parallel ones.

### Auth store

`src/stores/auth-store.ts` (Zustand):
- `role` -- user's role string
- `userId` -- user's UUID
- `assignedMachineId` -- machine assigned to this user (nullable)
- `setProfile()` / `clear()` -- state setters

### Offline-first data flow

ALL data mutations follow this pattern:

1. **Write to local SQLite first** via a repo.
2. **Enqueue to sync queue** for server push.
3. **SyncManager** pushes pending entries on next sync cycle.

```
Local write -> SQLite repo -> SyncQueueRepo.enqueue() -> SyncManager.push() -> Server
```

### SQLite repos (`src/db/`)

Each entity has a repo class that wraps SQLite operations:
- `trips-repo.ts` -- `TripsRepo`
- `bale-loads-repo.ts` -- `BaleLoadsRepo`
- `bale-productions-repo.ts` -- `BaleProductionsRepo`
- `fuel-logs-repo.ts` -- `FuelLogsRepo`
- `consumable-logs-repo.ts` -- `ConsumableLogsRepo`
- `operations-repo.ts` -- `OperationsRepo`
- `task-assignments-repo.ts` -- `TaskAssignmentsRepo`
- `sync-queue-repo.ts` -- `SyncQueueRepo` (the sync outbox)
- `schema.ts` -- table creation SQL
- `migrations.ts` -- local DB migrations

### Sync queue (`src/db/sync-queue-repo.ts`)

The sync queue is the core of offline sync:
```typescript
interface EnqueueInput {
  entityType: string;   // e.g., 'trips', 'bale_loads'
  entityId: string;     // UUID of the record
  action: string;       // 'create', 'update', 'delete'
  payload: unknown;     // the data to push
  idempotencyKey: string; // UUID, stable across retries -- NEVER use Date.now()
}
```

- Entries have status: `pending` -> `in_flight` -> `completed` / `failed`.
- `resetInFlight()` is called at the start of each sync to recover from interrupted cycles.
- `retry_count` tracks failed attempts.

### SyncManager (`src/sync/SyncManager.ts`)

Orchestrates the push/pull cycle:
1. `resetInFlight()` -- recover interrupted entries.
2. `push()` -- upload pending mutations via `POST /api/v1/sync/push`.
3. `pull()` -- fetch server deltas via `POST /api/v1/sync/pull` with per-table `sync_version`.
4. On success (no errors), upload today's mobile logs via `uploadTodayMobileLogs()`.

Supporting files:
- `src/sync/push.ts` -- push logic, binary file upload first. `DIRECT_ENDPOINT_TYPES` (`parcel_create`, `delivery_destination_create`, `register_load`, `cmr_scan`) bypass the generic table-mutation path for entity types with no matching SQLite table / a dedicated REST endpoint — add new file-upload-shaped or endpoint-shaped sync entities here, not to a repo.
- `src/sync/pull.ts` -- pull logic, merge into local SQLite. `parcels` now resolves its cursor via the persisted `sync_cursors` path like every other table (fixed a stale hardcoded-`0` bug — parcels DOES have a server `sync_version`, migration `00040`).
- `src/sync/conflict.ts` -- `mergeRecords()` for conflict resolution (server wins).
- `src/sync/outbox.ts` -- outbox pattern helpers.
- `src/sync/mobile-log-upload.ts` -- upload NDJSON logs after sync. Gated: `uploadTodayMobileLogs()` skips unless 10 min have passed since the last upload, an `error`/`warn` log entry is pending, or `options.force` is set (used by the remote `fetch_logs` fleet command).

### Sync triggers
- App comes to foreground (`AppState` change to `'active'`).
- Network reconnect.
- After a local write (2-second debounce).
- Periodic 60-second interval.

### useCurrentLoaderParcel

GPS-based active parcel detection for loader operators.
- GPS timeout: 15s (was 5s). After timeout, retries once after 5s.
- Status values: `locating` | `found` | `not_found` | `multiple_active` | `error`.
- `multiple_active`: GPS point matches more than one active parcel boundary — UI must ask the operator to choose manually.
- Snapshot of `parcelId` is taken at screen mount in `load-bales.tsx` to avoid mid-flow parcel switches.

### Departure flow (`driver-ops/departure-flow.tsx`)

Two-step screen that replaces a direct `depart` API call:
1. Odometer reading entry.
2. Driver signature capture.
Calls `POST /trips/:id/depart` with `{ departureOdometerKm, driverSignature }`.

### Delivery flow (`EnhancedDeliveryFlow.tsx`, sole delivery flow — `DeliveryFlow.tsx`/`SignatureStep.tsx` removed)

Every driver-delivery entry point renders `EnhancedDeliveryFlow` (`app/(driver)/delivery.tsx` → `app/driver-ops/delivery-flow.tsx`). **2 steps** (was 3 through 2026-07-24): step 0 weighing (`WeightInput`, plus a "Livrează fără cântărire" button setting `scaleBroken = true` and blanking both weights, for a depot with no working scale — mirrors `confirmDepotDelivery`'s own `scaleBroken`); step 1 `CmrConfirmation` (weight rows read "Fără cântărire" when `scaleBroken`). **No receiver-signature step exists anymore** (commit `b6beb2e`) — a failed signature upload could permanently stuck-retry the `complete` transition in the sync queue (payload could never pass `signatureUrlSchema`). `CompleteDto`/`completeSchema` no longer accept `receiverSignature` at all, so an already-queued bad payload from an old build gets it silently stripped by zod instead of rejected forever. `confirm-delivery` now sends `scaleBroken` and nullable `grossWeightKg`/`tareWeightKg`; the backend requires a positive gross weight unless `scaleBroken === true`.

### Loader board (`useLoaderBoard`, replaced `useTrucksAtLoader`, 2026-07-24)

The loader home (`app/(loader)/index.tsx`) is assignment-aware, keyed on `trips.loader_id` (not `loader_operator_id`). `useLoaderBoard()` (`src/hooks/useLoaderBoard.ts`) polls `GET /api/v1/location/loader-board/:machineId` every 15s, returning `{ assigned: AssignedTruck[], nearbyUnassigned: TruckAtLoader[] }`. `assigned` (each with a `presence: 'here'|'enroute'|'loaded'|'unknown'` badge + `distanceM`) is UI-merged with `auxTrips` into one "trucks to load" section; `nearbyUnassigned` renders dimmed/collapsible, tagged "unassigned". The old `useTrucksAtLoader` mobile hook is **deleted** (commit `d842737`, zero remaining importers) — the `packages/api` hook and backend `/location/trucks-at-loader` route are kept (still used elsewhere). When touching loader-home truck logic, use `useLoaderBoard`, not the old hook name.

### CMR scan — auxiliary loads (`app/loader-ops/load-bales.tsx`, new, Jul 2026)

Auxiliary (external-transporter) loads finish on a scanned paper CMR instead of the specimen signature — `proceedToFinish()` branches on `isAuxiliary`. Screen state machine `cmrStep: null | 'intro' | 'preview' | 'saving'`; `submitLoad()` (renamed from `handleSignatureConfirm`) is now shared by both finish paths and takes `{ loaderSignature? , cmr? }` (exactly one set).

- Capture: `src/lib/cmrScanner.ts` — ML Kit document scanner (`scanCmrPages()`), falls back to a plain camera shot (`captureCmrPageWithCamera()`) on `ScannerUnavailableError`. Kept in a separate file from the upload/queue code so the sync-queue drain path never imports the native scanner module.
- Build: `src/lib/cmrScanUpload.ts` `buildCmrPdf()` — downscales pages (1600px/JPEG 0.7), renders one A4 PDF via `expo-print`, moves it out of the evictable cache dir into `DocumentDirectory/cmr-scans/`, mints a stable `scanId` reused across retries. Built **before** anything is written server-side.
- Upload: `uploadCmrScan()` POSTs multipart to `POST /api/v1/cmr-scans/trip/:tripId`. Online failure queues (`enqueueCmrScan`) rather than failing the whole load registration.
- Sync queue: `cmr_scan` is a new `entity_type`, added to `push.ts`'s `DIRECT_ENDPOINT_TYPES` (file upload, not a table row). Its `action` must be `'insert'` (`sync_queue` has a `CHECK` constraint SQLite enforces — an invalid action throws inside `enqueue()`, silently dropping the mutation). It carries `registerLoadIdempotencyKey` so `push.ts` can defer a scan whose sibling `register_load` failed this cycle (`failedRegisterLoads` set).
- Offline addressing: `auxTripId` is now carried through the route params from the loader home's aux truck card (`(loader)/index.tsx`) specifically so the CMR can be addressed without a register-load response (which doesn't exist offline).

### Fleet Management + OTA self-update (`src/lib/device-checkin.ts`)

**Device identity**: `ensureDeviceId()` creates a stable device UUID (SecureStore key `strawboss.device_id`) on first run. The server's HMAC device token is persisted under `strawboss.device_token`. Both survive APK updates.

**Check-in (`runDeviceCheckin()`)**: public endpoint — `fleetApiClient` sends **no `Authorization` header**. Collects device UUID/token, app version code, hardware info (`getDeviceHardwareInfo()`), FCM push token, `isDeviceOwner` flag, active-trip flag, any batched OTA progress reports (`otaReports[]`), and any pending command reports (`commandReports[]`). POSTs to `POST /api/v1/fleet/checkin`. After a successful response, sent OTA reports are cleared from the local mirror and sent command reports are deleted from `strawboss.command_reports`. If `response.pendingCommand.type === 'tailscale'`, calls `handleTailscaleCommand()`.

Trigger points:
- `AuthGate` in `app/_layout.tsx`: on mount + every 60 s (unconditional — outside auth check).
- `runBackgroundSyncCycle()` in `src/sync/run-background-sync.ts`: **before** the `!token` guard so headless WorkManager cycles report telemetry and receive OTA even when no user is logged in.
- Push notification type `ota_checkin`: spread over a random 0-20 s delay (thundering-herd protection for a broadcast push), then forced past the gate.
- Push notification type `presence_wake` (FCM data message): handled by `REMOTE_NOTIFICATION_TASK` (below), not `ota_checkin`'s listener.
- `boot-rearm.ts`: called at the top of `bootRearm()` when `strawboss.pending_install_deployment_id` exists (post-OTA install re-report).

**Temporal gate (`runDeviceCheckin(opts?: { force?: boolean })`, traffic diet, Jul 2026)**: check-in is driven by 4 redundant, independent drivers (the JS interval above, the location-FGS piggyback, the background-sync piggyback, and the native `AlarmManager` headless task — see `FLEET-BACKGROUND-ONLINE.md`) because HONOR/MagicOS pauses the JS runtime and OEM-kills services. **Never remove any of the four drivers.** Unless `opts.force`, `runDeviceCheckin()` reads the last-SUCCESS timestamp (`health-state.ts` `readHealthTimestamps()`) and skips the network call if one landed within `CHECKIN_GATE_MS = 90_000` ms (±10% jitter). The stamp is written only on success, so a phone with a flaky network still retries every tick — only redundant calls on an already-healthy phone are cut.

**FCM data-wake (`src/lib/remote-notification-task.ts`, new)**: the backend presence dead-man (`QUEUE_PRESENCE_DEADMAN`, every 2 min) sends a high-priority FCM data message `{ type: 'presence_wake' }` to stale device-owner phones — this is the one signal that pierces deep Doze, which the native alarm alone cannot (measured 26-73 min overnight gaps). `REMOTE_NOTIFICATION_TASK` **must stay defined at the bundle entry** (`register-background-tasks.ts` → `index.js`), not only inside `_layout.tsx` — a headless-runtime FCM dispatch needs the task registered with no Activity mounted. On wake: re-assert `PresenceService` (if device owner) then call `presenceCheckin()` — the same function the native alarm tick calls.

**OTA orchestrator (`handlePendingDeployment()`)**: state machine persisted in `strawboss.ota_mirror`.
- Downloads APK via `expo-file-system` `downloadAsync` to `DocumentDirectory`.
- SHA-256 verified natively before install (rejects with `SHA_MISMATCH` on mismatch).
- Idle gate: `TripsRepo.listActive()` — if active trips exist and `installPolicy.forceNow` is false, defers install, records `awaiting_idle`.
- Writes `strawboss.pending_install_deployment_id` to SecureStore **before** calling `installApkSilent()` (process is killed during self-update).
- Max 3 install attempts (`MAX_INSTALL_ATTEMPTS = 3`).
- OTA state values: `pending` / `notified` / `downloading` / `downloaded` / `awaiting_idle` / `installing` / `installed` / `failed`.

**Post-restart re-report**: `boot-rearm.ts` reads `strawboss.pending_install_deployment_id`; if set, runs `runDeviceCheckin()` pre-auth; the new `versionCode` proves install success to the server.

**`deviceId` in log upload**: `uploadTodayMobileLogs()` includes `deviceId: deviceUuid` in `POST /api/v1/logs/mobile` so pre-login device logs are attributable per device.

**No new npm dependencies** — uses existing `expo-secure-store`, `expo-file-system/legacy`, `expo-notifications`, `@strawboss/api`, `@strawboss/types`.

### Native `DeviceOwner` module additions (`plugins/withDeviceOwner.js`, `src/lib/device-owner.ts`)

`DeviceOwnerModule.kt` exposes the following `@ReactMethod` entries relevant to fleet management (all have matching JS wrappers in `src/lib/device-owner.ts` that return `false`/`{}` on iOS/Expo Go and never throw):

| Native method | JS wrapper | Description |
|---|---|---|
| `getDeviceHardwareInfo(Promise)` | `getDeviceHardwareInfo()` | Returns `{ model, manufacturer, osVersion, androidId }` from Android `Build` + `Settings.Secure`. No dangerous permission. Returns `{}` on iOS / Expo Go. |
| `installApkSilent(path, expectedSha256, Promise)` | `installApkSilent(absolutePath, sha256)` | SHA-256 verifies APK, then opens `PackageInstaller.Session(MODE_FULL_INSTALL)`, streams the file, fsyncs, commits via PendingIntent to `InstallResultReceiver`. Device owner suppresses user prompt. Returns `false` on non-Android. |
| `isPackageInstalled(packageName, Promise)` | `isPackageInstalled(packageName)` | Calls `PackageManager.getPackageInfo()`. `true` if installed, `false` on `NameNotFoundException`. Never throws to JS. |
| `setTailscaleManaged(authKey, hostname, tailnet, Promise)` | `setTailscaleManaged(authKey, hostname, tailnet)` | Pushes App Restrictions to `com.tailscale.ipn` (`AuthKey`, `Hostname`, `Tailnet`, `AlwaysOn.Enabled=true`) via `setApplicationRestrictions()` then `setAlwaysOnVpnPackage()`. Requires API 24+. Rejects `TS_NOT_INSTALLED` if Tailscale is absent. |
| `clearTailscaleManaged(Promise)` | `clearTailscaleManaged()` | Calls `setAlwaysOnVpnPackage(admin, null, false)` and pushes `AlwaysOn.Enabled=false`. Disables always-on VPN. |

**tsnet is NOT available on Android.** The official `com.tailscale.ipn` app is controlled via MDM (App Restrictions + `setAlwaysOnVpnPackage`).

New manifest additions (generated by `withManifest()`):
- `android.permission.REQUEST_INSTALL_PACKAGES` — required for `PackageInstaller` on API 26+.
- `.InstallResultReceiver` broadcast receiver (`android:exported="false"`) — receives silent install status broadcasts from `PackageInstaller`.

`InstallResultReceiver` logs `STATUS_SUCCESS` / `STATUS_PENDING_USER_ACTION` (warning) / failure — best-effort only; JS promise resolves before the broadcast and the process may be dead during self-update.

### Tailscale remote control — command handler (`handleTailscaleCommand()`)

Located in `src/lib/device-checkin.ts`. Called from `runDeviceCheckin()` when the check-in response contains `pendingCommand.type === 'tailscale'`.

**`action === 'up'` flow:**
1. Read `strawboss.tailscale_state` from SecureStore. If already `'up'`, report success without a native call (idempotent).
2. Call `isPackageInstalled('com.tailscale.ipn')`.
3. **Zero-touch auto-install** — if Tailscale is NOT installed and `command.payload.tailscaleApk` is provided (`{ url: string, sha256: string }`):
   - Download from `${API_URL}${apkRef.url}` to `DocumentDirectory/tailscale-install.apk` via `FileSystem.downloadAsync`.
   - Call `installApkSilent(downloadResult.uri, apkRef.sha256)` — SHA-256-verified, silent Device Owner install (reuses the existing `installApkSilent` method; no new npm deps).
   - Throw and report failure if install returns `false`.
4. Call `setTailscaleManaged(payload.authKey, payload.hostname, payload.tailnet)`.
5. Persist `'up'` to `strawboss.tailscale_state`.
6. Append `DeviceCommandReport { commandId, status: 'success' }` to `strawboss.command_reports`.

**`action === 'down'` flow:**
1. If `strawboss.tailscale_state` is already `'down'`, skip and report success.
2. Call `clearTailscaleManaged()`.
3. Persist `'down'` to `strawboss.tailscale_state`.
4. Append success report.

On any error in either branch, a failure report `{ commandId, status: 'failure', error }` is appended. Handler never throws.

**SecureStore keys added:**

| Key | Content |
|---|---|
| `strawboss.command_reports` | `DeviceCommandReport[]` JSON — pending delivery to the server |
| `strawboss.tailscale_state` | `'up'` \| `'down'` — last successfully applied Tailscale state |

**Report delivery**: `commandReports[]` are included in the next `DeviceCheckinRequest` body; cleared from SecureStore after a successful POST.

### Heartbeat & background presence (`src/lib/heartbeat.ts`, `src/lib/device-owner.ts`)

`startHeartbeat()` pings `POST /api/v1/profile/heartbeat` roughly every 60-65 s (jittered `60_000 + random(5_000)`; was a flat 30 s). `sendHeartbeatOnce()` self-dedups: it skips the POST if `health-state.ts` shows a success within the last 55 s, so the JS `setInterval` driver and the native-alarm-triggered `presenceCheckin()` driver don't double-send when they land close together. A failed send never stamps, so retries continue on every tick.

- **Non-device-owner**: heartbeat is stopped when `AppState` goes `'background'` (battery saving).
- **Device-owner**: `isDeviceOwnerResolved()` (synchronous memoized flag) returns `true`; the heartbeat is NOT stopped on background because a foreground service keeps the JS thread alive.

**PresenceService** (native, `plugins/withDeviceOwner.js`): a `specialUse` Android FGS that holds the process at foreground importance. Started for device-owner installs whose role has **no** `assignedMachineId` (`geofence_maker`, `depot_manager`). Roles with a machine skip it — they already have the GPS location FGS. Notification channel: `strawboss-presence`, `IMPORTANCE_MIN`. JS bindings: `startPresenceService()` / `stopPresenceService()` in `src/lib/device-owner.ts`.

**React Query `focusManager` wiring (root `_layout.tsx`)**: the `AppState` listener calls `focusManager.setFocused(state === 'active')`. On Device-Owner builds the JS runtime never freezes with the screen off, so without this every `refetchInterval` hook would keep polling in the background — this single call stops all foreground polling once backgrounded (`refetchIntervalInBackground` defaults `false`).

### Location tracking (`src/lib/location.ts`)

Background location tracking for GPS-equipped devices. Reports machine position for geofence checks on the server side. The foreground `useLocationTracking` hook still POSTs `POST /api/v1/location/report` per fix, unchanged.

**Background batching (traffic diet F2, Jul 2026)**: the `TaskManager` background task no longer posts each GPS fix immediately — it appends to an on-disk outbox and a persisted gate (`maybeFlushBatchedLocationReports()`, `BACKGROUND_FLUSH_MIN_INTERVAL_MS = 60_000`) throttles actual flush attempts to ~once/min. Flushing sends chunks of `BATCH_CHUNK_SIZE = 30` via `POST /api/v1/location/report/batch`, persisting the outbox after each chunk (crash-safe, same guarantee as the pre-batch single-report loop). A 404/405 from the batch endpoint permanently flips `batchUnsupported` for the process and falls back to the original one-POST-per-report loop (old-backend rollout window). Background piggyback sync (`maybePiggybackSync()`) is now trip-adaptive: 60 s with an active trip, 180 s idle (`hasActiveTripCached()`, 60 s TTL, backed by `hasActiveTrip()` exported from `device-checkin.ts`) — plus ±10% jitter on both this and the presence-checkin throttle to desync the fleet.

### Polling cadence (traffic diet, Jul 2026)

Several hook `refetchInterval`s were widened to cut aggregate fleet request rate: the loader-home trucks hook (now `useLoaderBoard`, see above) 10s→15s, `useAuxiliaryTrips` 15s→30s, `useMachineLastLocation`/`useMyTasks`/`useNearbyLoaders` 30s→60s, `MapScreen` related-machines 15s→30s. When adding a new polling hook, default to the widest interval the UI can tolerate and rely on the `focusManager` wiring above rather than a manual pause/resume — do not reintroduce a flat 10-15s poll without a specific reason.

### Geofence overlay

Handles boundary enter/exit events. Must debounce rapid events to prevent duplicate notifications for the same crossing.

### Mobile logging (`src/lib/logger.ts`)

- `mobileLogger` appends NDJSON to `DocumentDirectory/strawboss-logs/YYYY-MM-DD.ndjson`.
- Methods: `.info()`, `.error()`, `.warn()`, `.flow()` (business transitions).
- `cleanupOldMobileLogFiles()` removes files older than 7 days. Called on app start and foreground resume.
- Logs are uploaded to the server after successful sync.

### API client (`src/lib/api-client.ts`)

`mobileApiClient` -- configured ApiClient for direct (non-synced) API calls:
- Profile fetch
- Push notification token registration
- Any read-only queries

For mutations that need offline support, use the sync queue instead.

### Push notifications (`src/lib/notifications.ts`)

`registerForPushNotifications()` requests permission and returns an Expo push token. The token is sent to `POST /api/v1/notifications/register-token` with platform info and machine ID.

`registerBackgroundNotificationTask()` (new) calls `Notifications.registerTaskAsync(REMOTE_NOTIFICATION_TASK)` — activates the FCM data-wake handler (`src/lib/remote-notification-task.ts`, see Fleet Management above). Called unconditionally on `_layout.tsx` mount (not gated on auth); best-effort, never blocks launch.

### Map (`src/map/`)

WebView-based map rendering with a bridge for communication between React Native and the web map.

**Local-first cache (fixed 2026-07-14, commit `79dc421`)**: `useCachedParcels`/`useCachedDepots` (`src/hooks/`) are what the map actually renders from — two React Query queries each, a `PARCELS_LOCAL_KEY`/`DEPOTS_LOCAL_KEY` query reading straight from SQLite (`networkMode: 'always'`, load-bearing — the default `'online'` mode pauses a query while offline) and a `PARCELS_REFRESH_KEY`/`DEPOTS_REFRESH_KEY` background query that fetches REST and writes the result back into SQLite. Never wire a map screen to `GET /api/v1/parcels`/`/delivery-destinations` directly — a save's own `invalidateQueries` racing that fetch is exactly what erased freshly-drawn fields for minutes before this fix. Two repo methods matter: `ParcelsRepo.upsertFromPull()` (pull-path upsert that deliberately never touches `geometry`/`centroid_json` — `/sync/pull` doesn't carry them) and `reconcileWithServer(serverIds)` on both repos (deletes cache rows the server dropped, exempting rows with an open `sync_queue` entry; refuses to run on an empty list). After any local write to `parcels`/`delivery_destinations`, invalidate the `*_LOCAL_KEY`; call `triggerSync()` too if the write should reach the server promptly (`geofence_maker` has no GPS-piggyback sync driver). See [[mobile]] "Local-first map cache" for the full writeup, including the on-device area calc (`src/utils/geo-area.ts`, authalic-latitude projection).

### Android release build safety (R8/Proguard)

**`plugins/withHeadlessProguard.js`** (fixed 2026-07-13, commit `1ab36c5`) keeps Expo's headless JS app loader (`expo.modules.adapters.react.apploader.**`, `expo.modules.apploader.**`, plus `taskManager`/`backgroundtask`) from being stripped by R8 — it's resolved only via `Class.forName()` reflection, so R8 sees no static reference and silently deletes it, which kills **every** JS background entry point (boot-rearm, presence check-in, background sync, FCM wake) while the native side still looks perfectly healthy. This was the root cause of a major fleet always-on incident. Rules: (1) never hand-edit `android/app/proguard-rules.pro` — `expo prebuild` regenerates it and clobbers the edit, always go through a config plugin like this one; (2) never disable minification wholesale as a "fix" for a stripped class — find the specific package and `-keep` it surgically instead (R8 also removes a lot of genuinely-dead legacy unimodules glue under `expo.modules.adapters.react.*` that should stay stripped).

## Rules you must follow

1. **Offline-first**: All data mutations go through SQLite repo + sync queue. Never make direct POST/PUT/DELETE API calls for mutable data.
2. **Stable idempotency keys**: Use the entity's UUID as the idempotency key. Never use `Date.now()`, `Math.random()`, or anything that changes across retries.
3. **UUID for all record IDs**: Locally-created records must use UUID strings. Never use auto-increment integers -- they will conflict during sync.
4. **Role-based screens**: Place screens in the correct layout group: `/(baler)`, `/(loader)`, `/(driver)`, `/(geofence-maker)`, or `/(tabs)`.
5. **Use mobileApiClient for reads**: Direct API calls use `mobileApiClient` from `src/lib/api-client.ts`.
6. **Log with mobileLogger**: Use `mobileLogger.flow()` for business transitions, `.error()` for errors.
7. **Clean up subscriptions**: Effects that set up listeners (AppState, auth, location) must return cleanup functions.
8. **Add migrations**: New SQLite tables need entries in `src/db/migrations.ts`.
9. **Register repos in SyncManager**: New repos must be added to the `SyncManager` constructor.
10. **Update docs**: After code changes, update `.claude/docs/mobile.md` (and `agents/mobile-agent.md` if patterns changed), or run the `strawboss-sync-docs` skill.
11. **`sync_queue.action` must be `'insert' | 'update' | 'delete'`**: the table has a `CHECK` constraint SQLite enforces at the driver level — any other value (e.g. a bespoke verb like `'register'`) makes `enqueue()` throw and the mutation is silently never queued. Bug precedent: commit `3628cdf`/`d8ed54d` (CMR scan feature).
12. **File-upload / dedicated-endpoint sync entities go in `push.ts`'s `DIRECT_ENDPOINT_TYPES`**, not through the generic table-mutation path or a new SQLite-backed repo — see `cmr_scan` for the pattern (payload carries a local file URI, not row data).
13. **New polling hooks default wide**: prefer the widest `refetchInterval` the UI can tolerate (see "Polling cadence" above) and rely on the root `focusManager.setFocused()` wiring in `_layout.tsx` to stop polling in the background — don't add a manual per-hook `AppState` pause/resume.
14. **Maps render from local SQLite, never straight from REST**: use `useCachedParcels`/`useCachedDepots` (or add a same-shaped hook) — a screen that fetches `/parcels`/`/delivery-destinations` directly and paints the map from the response WILL race a save's own `invalidateQueries` and erase freshly-drawn offline data. See "Local-first cache" under Map above.
15. **Never hand-edit `android/app/proguard-rules.pro` or other files under `android/`**: `expo prebuild` regenerates the whole `android/` directory and silently clobbers hand-edits. Any native Android change (proguard rules, manifest entries, gradle config) must go through a config plugin in `plugins/` (see `withHeadlessProguard.js`, `withDeviceOwner.js`, `withAlwaysOnTracking.js`), applied idempotently (guard against running twice on repeated `prebuild`).
16. **Gating a screen behind a `uiOnly` feature** (registry + mobile consumption layer documented in `.claude/docs/feature-toggles.md`; four screens wired in `e275b3c` — `(deposit)/index.tsx`+`_layout.tsx`, `(deposit)/confirm-delivery.tsx`, `(geofence-maker)/map.tsx`, `FuelEntryFlow.tsx`):
    - Gate only the **entry point** when the rest is naturally unreachable once it's gone (e.g. `{!drawMode && drawEnabled && <FAB/>}`) — everything downstream becomes dead-by-construction, so don't chase every individual control gated by the same flag.
    - When the feature governs a **required input**, derive one `effectiveX = rawX || !featureEnabled` value and fold it through validation, the request payload, AND the JSX from that single flag — never gate validation and JSX independently. Hiding the input alone while validation still reads the raw (never-set) state leaves the submit button permanently disabled, silently bricking that whole flow for the org.
    - When the gated tab **is** the route group's initial route (`index`), pair `featureTabOptions(enabled, remainingTabs)` in `_layout.tsx` with a `<Redirect>` inside that screen itself — a hidden tab alone still renders a now-unreachable screen with no way back to the tab bar.
