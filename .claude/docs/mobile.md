---
type: doc
title: "Mobile App (apps/mobile)"
created: 2026-04-16
updated: 2026-07-31
tags: [doc, mobile, layer, expo, react-native, offline-first]
status: mature
related:
  - "[[architecture]]"
  - "[[sync-protocol]]"
  - "[[packages-api]]"
  - "[[packages-ui-tokens]]"
  - "[[backend]]"
  - "[[feature-toggles]]"
---

# Mobile App (`apps/mobile`)

Expo SDK 54 + Expo Router. Offline-first: all writes go to local SQLite + sync queue, synced to server when online.

---

## Navigation

### Root layout (`app/_layout.tsx`)

1. **Database init**: `getDatabase()` runs SQLite migrations before rendering any routes
2. **AuthGate**: checks Supabase session, fetches profile via `GET /api/v1/profile`, routes to role-specific tab group
3. **Fleet check-in**: `runDeviceCheckin()` fires unconditionally on `AuthGate` mount and every 60 s — runs **before** the auth check so OTA and fleet telemetry work pre-login. Every call is now subject to a shared ~90 s temporal gate (skips the network round-trip if a sibling driver already succeeded recently — see Fleet Management below) unless forced. An `ota_checkin` push notification type spreads over a random 0-20 s delay (thundering-herd protection for a broadcast push), then forces past the gate.
4. **Push token registration**: after profile load, calls `registerForPushNotifications()` -> `POST /api/v1/notifications/register-token`. `registerBackgroundNotificationTask()` is also called unconditionally on mount (not gated on auth) to bind the FCM data-wake handler — see "FCM data-wake" below.
5. **Log cleanup**: runs `cleanupOldMobileLogFiles()` on mount and on each `AppState` resume
6. **React Query focus wiring**: the root `AppState` listener calls `focusManager.setFocused(state === 'active')` (from `@tanstack/react-query`). On Device-Owner builds the JS runtime never freezes with the screen off (a foreground service keeps it alive), so without this every `refetchInterval` hook would keep polling in the background; `refetchIntervalInBackground` defaults to `false`, so this one line stops all foreground polling once the app backgrounds.

### Auth & Session Persistence (`src/lib/auth.ts`, `src/lib/secure-store-adapter.ts`)

`getSupabaseClient()` initialises the Supabase singleton with a **SecureStore-backed storage adapter** (`secureStoreAdapter`) and `detectSessionInUrl: false`. This means:

- The JWT + refresh token are **encrypted at rest** in `expo-secure-store` and survive cold restarts. Operators no longer need to log in again each shift after the phone is rebooted.
- The session is auto-refreshed by `supabase-js` (default `autoRefreshToken: true`).
- The session is cleared **only** on explicit logout (`supabase.auth.signOut()`) or when Supabase detects a genuinely revoked refresh token.

**SecureStore chunking** (`src/lib/secure-store-adapter.ts`): SecureStore caps each value at ~2048 bytes. A full Supabase session JSON (JWT + refresh token + user object) exceeds that. The adapter transparently splits large values into UTF-8-byte-bounded chunks (max `1800` bytes each) stored under sibling keys (`key__sb0`, `key__sb1`, ..., `key__sbchunks` for the count) and reassembles on read.

**Profile-fetch failure path**: if the `GET /api/v1/profile` call fails (e.g. flaky network at shift start), the auth gate **does not call `supabase.auth.signOut()`**. Instead it shows a retry modal ("Eroare de conectare"). The persisted session remains intact. This prevents operators from being logged out by a transient server error.

**Store hydration guard**: `AuthGate` waits for `useAuthStore.persist.hasHydrated()` before firing the profile fetch. This means a returning operator with a persisted `role` gets routed to their home screen on a cold boot without a network round-trip.

**Single-flight refresh guard**: `refreshAuthToken()` now dedups concurrent callers behind one shared in-flight promise (`refreshInFlight`). Pull, push, log upload, and location reporting can all hit a 401 at the same instant (they share one token expiry) — without this, each would fire its own parallel `refreshSession()` call, wasteful and racy against Supabase's own refresh-token rotation.

### Role-based routing

`ROLE_ROUTES` in `_layout.tsx`:

| Role | Route Group | Layout File |
|---|---|---|
| `baler_operator` | `/(baler)` | `app/(baler)/_layout.tsx` |
| `loader_operator` | `/(loader)` | `app/(loader)/_layout.tsx` |
| `driver` | `/(driver)` | `app/(driver)/_layout.tsx` |
| `geofence_maker` | `/(geofence-maker)` | `app/(geofence-maker)/_layout.tsx` |
| `depot_manager` | `/(deposit)` | `app/(deposit)/_layout.tsx` (Plan C) |
| Other/admin | `/(tabs)` | `app/(tabs)/_layout.tsx` |

If `segments[0]` does not match the target segment for the user's role, the auth gate redirects.

### 5 tab layouts

**Baler** (`app/(baler)/_layout.tsx`): Acasa (home), Consumabile, Harta, Starea Mea (stats), Profil
**Driver** (`app/(driver)/_layout.tsx`): Cursele Mele (trips), Livrare, Harta, Combustibil, Profil
**Loader** (`app/(loader)/_layout.tsx`): Scaneaza (scan), Incarcari (bales), Harta, Consumabile, Profil
**Geofence Maker** (`app/(geofence-maker)/_layout.tsx`): index, farms, map, Profil
**Deposit Manager** (`app/(deposit)/_layout.tsx`): index (inventory), trips, Profil (Plan C)
**Admin/fallback** (`app/(tabs)/_layout.tsx`): Home, Scan, Trips, Sync, Profil

All role-specific layouts (baler/driver/loader) mount `GeofenceOverlay` on top of all screens via `useGeofenceNotifications()`.

---

## Screens per Role

### Baler (`app/(baler)/`)
| Screen | File | Purpose |
|---|---|---|
| Home | `index.tsx` | Task list via `useMyTasks()`, launch `ProductionFlow` |
| Consumables | `consumables.tsx` | Launch `ConsumableFlow` (diesel or twine) |
| Map | `map.tsx` | `MapScreen` -- parcels, machine locations, OSRM routing |
| Stats | `stats.tsx` | `OperatorStats` -- personal production charts |
| Profile | `profile.tsx` | `ProfileScreen` -- view/edit profile, logout |
| Parcel detail | `(baler)/parcel/[parcelId].tsx` | Baler workflow for a specific parcel -- `BalerEntryCountdown`, `HarvestFinishPicker` (Plan B) |

### Deposit Manager (`app/(deposit)/`)
| Screen | File | Purpose |
|---|---|---|
| Index | `index.tsx` | Depot inventory overview (incoming trips, bale counts) |
| Trips | `trips.tsx` | Trips arriving at this depot |
| Confirm delivery | `confirm-delivery.tsx` | Depot operator confirms an incoming truck's delivery (bale count + weighing); detail screen reached from Trips, hidden from the tab bar (`href: null`) |
| Profile | `profile.tsx` | `ProfileScreen` |

**Feature-gated (`e275b3c`, see [[feature-toggles]]):**
- `depot.inventory` (`uiOnly`) — `index` is both this tab group's initial route and the inventory screen itself, so hiding the tab alone (`featureTabOptions(inventoryEnabled, 2)` in `_layout.tsx`) would strand the depot manager on a screen with no tab-bar entry. `index.tsx` also checks the flag directly and renders `<Redirect href="/(deposit)/trips" />` when disabled — the same shape `(geofence-maker)` uses (see PointPicker/map notes below).
- `depot.weighing` (`uiOnly`) — `confirm-delivery.tsx` derives `effectiveScaleBroken = scaleBroken || !weighingEnabled` and threads that *single* value through validation (`weightsValid`), the transition request body (`scaleBroken: effectiveScaleBroken`, plus gross/tare weight fields sent only when `!effectiveScaleBroken`), and the JSX gate on the weight inputs (`isPrincipal && weighingEnabled`). **Load-bearing correctness trap**: any future edit to the weight-validation or payload logic must keep folding through `effectiveScaleBroken`, not the raw `scaleBroken` state — hiding just the inputs without that fold leaves `canSubmit`/`weightsValid` permanently `false`, silently bricking depot-delivery confirmation for the whole org the moment `depot.weighing` is off. The server already accepts a weightless delivery when `scaleBroken: true`, so no backend endpoint changed.

### Driver (`app/(driver)/`)
| Screen | File | Purpose |
|---|---|---|
| Trips | `index.tsx` | Active trips list, links to trip detail |
| Delivery | `delivery.tsx` | Featured active trip -> `driver-ops/delivery-flow.tsx` -> `EnhancedDeliveryFlow` |
| Map | `map.tsx` | `MapScreen` with route to destination |
| Fuel | `fuel.tsx` | `FuelEntryFlow` -- record fuel consumption |
| Profile | `profile.tsx` | `ProfileScreen` |

### Loader (`app/(loader)/`)
| Screen | File | Purpose |
|---|---|---|
| Home | `index.tsx` | `LoaderHomeScreen` -- active field card + assignment-aware trucks board (`useLoaderBoard`, see "Loader Board" section), QR scan entry point |
| Bales | `bales.tsx` | `LoadingFlow` -- record bale loads onto trips |
| Map | `map.tsx` | `MapScreen` with related machine locations |
| Consumables | `consumables.tsx` | `ConsumableFlow` |
| Profile | `profile.tsx` | `ProfileScreen` |

### Geofence Maker (`app/(geofence-maker)/`)
| Screen | File | Purpose |
|---|---|---|
| Home | `index.tsx` | Dashboard / overview |
| Farms | `farms.tsx` | Farms list |
| Map | `map.tsx` | `MapScreen` with geofence boundaries |
| Profile | `profile.tsx` | `ProfileScreen` |

### Admin/generic (`app/(tabs)/`)
| Screen | File | Purpose |
|---|---|---|
| Home | `index.tsx` | Overview dashboard |
| Scan | `scan.tsx` | QR scanner |
| Trips | `trips.tsx` | Trip list |
| Sync | `sync.tsx` | Manual sync trigger + status |
| Profile | `profile.tsx` | `ProfileScreen` |

### Standalone screens
| Screen | File | Purpose |
|---|---|---|
| Trip detail | `app/trip/[tripId].tsx` | Full trip detail with state transitions |
| Baler production | `app/baler-ops/production.tsx` | `ProductionFlow` standalone entry |
| Driver departure | `app/driver-ops/departure-flow.tsx` | Two-step departure flow: odometru + semnătură șofer (replaces direct depart call) |
| Driver delivery | `app/driver-ops/delivery-flow.tsx` | `EnhancedDeliveryFlow` standalone entry |
| Loader bales | `app/loader-ops/load-bales.tsx` | `LoadingFlow` standalone entry |
| Deliver operation | `app/operations/deliver.tsx` | Operation-based delivery |
| Load operation | `app/operations/load.tsx` | Operation-based loading |

---

## Offline-First Architecture

### SQLite Tables (`src/db/schema.ts`)

8 tables, all with `server_version INTEGER DEFAULT 0`:

| Table | Key Columns | Purpose |
|---|---|---|
| `operations` | id, type, status, machine_id, parcel_id, trip_id, bale_count, weight_kg, photo_uri, signatures | Local operation tracking |
| `trips` | id, trip_number, status, source_parcel_id, truck_id, driver_id, bale_count, odometer fields, weight fields | Mirror of server trips |
| `sync_queue` | id (AUTOINCREMENT), entity_type, entity_id, action, payload, idempotency_key, status, retry_count, last_error | Outbox for pending mutations |
| `bale_productions` | id, parcel_id, baler_id, operator_id, production_date, bale_count | Baler output records |
| `fuel_logs` | id, machine_id, operator_id, quantity_liters, odometer_km | Fuel consumption |
| `consumable_logs` | id, machine_id, operator_id, consumable_type, quantity, unit | Twine/other consumables |
| `bale_loads` | id, trip_id, parcel_id, bale_count, gps_lat, gps_lon | Bales loaded per trip |
| `task_assignments` | id, assignment_date, machine_id, parcel_id, assigned_user_id, sequence_order, status | Daily task plan |

### Migrations (`src/db/migrations.ts`)
`runMigrations(db)` runs `CREATE TABLE IF NOT EXISTS` for all 8 tables + creates 14 indexes (on status, operator_id, parcel_id, trip_id, assignment_date, etc.).

### Repositories
Each table has a repo class in `src/db/`:
- `TripsRepo` (`trips-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `BaleProductionsRepo` (`bale-productions-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `FuelLogsRepo` (`fuel-logs-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `ConsumableLogsRepo` (`consumable-logs-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `BaleLoadsRepo` (`bale-loads-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `TaskAssignmentsRepo` (`task-assignments-repo.ts`) -- CRUD + `getMaxServerVersion()`
- `OperationsRepo` (`operations-repo.ts`) -- local operation state
- `SyncQueueRepo` (`sync-queue-repo.ts`) -- `enqueue()`, `dequeue(limit)`, `markInFlight()`, `markCompleted()`, `markFailed()`, `resetInFlight()`

### SyncManager (`src/sync/SyncManager.ts`)

Orchestrates the full push/pull cycle:

1. **`resetInFlight()`**: crash recovery -- any entries stuck as `in_flight` from interrupted sync are reset to `pending`
2. **Push** (`src/sync/push.ts`): dequeues up to 50 entries, marks `in_flight`, POSTs to `POST /api/v1/sync/push` as `SyncPushRequest`. Each entry carries an `idempotency_key` (e.g. `bale_production_{id}`, `fuel_log_{id}`). Server returns `applied`, `skipped`, or `conflict` per mutation. Entries whose `entity_type` is in `DIRECT_ENDPOINT_TYPES` (`parcel_create`, `delivery_destination_create`, `register_load`, `cmr_scan`) bypass the generic table-mutation path and hit a dedicated handler/endpoint instead.
3. **Pull** (`src/sync/pull.ts`): collects `getMaxServerVersion()` from each repo (plus `parcels` — see the fix below), POSTs to `POST /api/v1/sync/pull` with `{ tables: { trips: N, bale_loads: N, parcels: N, ... } }`. Server returns deltas
4. **Merge** (`src/sync/conflict.ts`): `mergeRecords()` resolves local vs server data using `server_version` as arbiter. Existing records are merged, new records are inserted via repo `upsert()`
5. **Log upload**: on zero-error sync, calls `uploadTodayMobileLogs()` (`src/sync/mobile-log-upload.ts`) to POST today's NDJSON log file to `POST /api/v1/logs/mobile` — now gated, see "Mobile log upload gate" below

**Parcels delta-sync fix**: `SyncManager.pull()` used to hardcode `parcels: 0` on every pull request (a stale FM-13 comment claimed parcels had no `sync_version` column). Parcels DOES have a server-side `sync_version` (migration `00040`) and the pull response includes it, so the parcels cursor now resolves through the same persisted `sync_cursors` path as every other table (`versions['parcels'] = await resolveVersion('parcels', async () => 0)`). Fresh installs (and any existing install that never persisted a parcels cursor) still fall back to `0` — a one-time full parcels pull, then delta from then on. Note: a parcel's own row rarely changes version even on this delta path, because the server also force-includes parcels newly visible via today's task assignments / active trips (a visibility change, not a row-version bump). The separate bug where this pull path *wrote* `geometry: null` on every cycle is fixed by `ParcelsRepo.upsertFromPull()` — see "Local-first map cache" under Map Tab.

### Sync queue status values
`pending` -> `in_flight` -> `completed` | `failed`

---

## Geofence UX

### useGeofenceNotifications (`src/hooks/useGeofenceNotifications.ts`)

Listens for 3 notification types via Expo notification listeners:

| Type | Source | UI |
|---|---|---|
| `field_entry` | Foreground notification | `EntryBanner` -- green slide-down, auto-dismiss 5s |
| `deposit_entry` | Foreground notification | `EntryBanner` -- blue slide-down, auto-dismiss 5s |
| `geofence_exit_confirm` | Foreground or tap from background | `ExitConfirmModal` -- fullscreen bottom sheet |

**Alert queue pattern**: alerts are queued in `alertQueue` state array, processed FIFO. `dismissAlert()` shifts the queue. `confirmParcelDone(assignmentId, baleCount?)` calls `POST /api/v1/notifications/confirm-parcel-done` then shifts.

### GeofenceOverlay (`src/components/shared/GeofenceOverlay.tsx`)

Two display modes:

1. **EntryBanner**: animated slide-in (spring), auto-dismiss 5s, green/blue background, icon + message
2. **ExitConfirmModal**: bottom sheet modal with `NumericPad` for bale count, "Confirma" + "Nu am terminat" buttons. Calls `onConfirmParcelDone` on confirm

Mounted in every role-specific tab layout (baler, driver, loader) as an absolute overlay at `zIndex: 9999`.

---

## Map Tab

### Architecture: WebView + Leaflet bridge

- `MapView` (`src/components/map/MapView.tsx`): React Native `WebView` loading a local `leaflet-map.html` file. Exposes `sendCommand(cmd: MapCommand)` via `useImperativeHandle`
- `MapScreen` (`src/components/map/MapScreen.tsx`): screen-level component that fetches parcel/machine data and sends commands to MapView
- `ParcelInfoSheet` (`src/components/map/ParcelInfoSheet.tsx`): bottom sheet shown on parcel tap

### Local-first map cache (`useCachedParcels`, `useCachedDepots`, fixed 2026-07-14, commit `79dc421`)

**The maps render from local SQLite, never from the network directly** — the CLAUDE.md invariant. `useCachedParcels` (`src/hooks/useCachedParcels.ts`) and `useCachedDepots` (`src/hooks/useCachedDepots.ts`) were rewritten from a bare mount-once `useEffect` (network-first, invisible to `invalidateQueries`) into **two React Query queries each**:

1. A **local** query (`PARCELS_LOCAL_KEY` / `DEPOTS_LOCAL_KEY`) that reads straight from SQLite (`ParcelsRepo.listAll()` / `DeliveryDestinationsRepo.listAll()`), `staleTime: Infinity`, `networkMode: 'always'` — load-bearing: the default `'online'` mode would *pause* this query while offline, starving the map of the cache exactly when the cache is all that's left. This is what the map (and the geofence-maker's farm list / draw screen) renders.
2. A **background refresh** query (`PARCELS_REFRESH_KEY` / `DEPOTS_REFRESH_KEY`) that fetches `GET /api/v1/parcels` / `GET /api/v1/delivery-destinations`, writes the result into SQLite, then invalidates the local key so it re-reads. Its failure is a non-event (offline just means the map keeps the cache); `fromCache` in the hook result is `true` until this has succeeded once this session.

A parcel drawn by the geofence-maker is therefore on the map in the same frame as the success modal — previously the map read `GET /api/v1/parcels` directly, whose refetch (triggered by the save's own `invalidateQueries`) returned a server list that had never heard of the brand-new parcel, wiping it back off the map for as long as it took the 15-min WorkManager cycle to sync it (a `geofence_maker` has no assigned machine, hence no GPS-piggyback and no ~2 min sync).

Supporting fixes bundled in the same commit:
- **`ParcelsRepo.upsertFromPull()`** (new): pull-path upsert that updates `name`/`code`/`area_hectares`/`municipality`/`harvest_status`/`crop_type`/`farm_name` but leaves `geometry`/`centroid_json`/`farm_id` untouched — `/sync/pull` never carries geometry (server excludes `boundary`/`centroid` from `PULL_COLUMNS`, see the "Pull carries no geometry" invariant), and the old `SyncManager.applyPulledUpdate` wrote `geometry: null` on every pull because it read an always-undefined `data['boundary']`. Rule: a writer that cannot observe a column must not write it. `SyncManager` now calls this instead of the generic `upsert()` for `parcels` pull rows.
- **`reconcileWithServer(serverIds)`** on both `ParcelsRepo` and `DeliveryDestinationsRepo`: deletes cached rows the server list no longer contains, **exempting rows with an open `sync_queue` entry** (`entity_type = 'parcel_create' | 'delivery_destination_create'`, `status IN ('pending','in_flight','failed')`) so an offline-drawn field isn't mistaken for a deletion. Refuses to run against an empty `serverIds` list (a permissions/transport fault, not "this org has zero parcels"). Depots carry no delta-sync tombstones at all — this REST-driven reconcile is the *only* channel by which a phone learns a depot was deleted.
- **`parcels.farm_id` column** (new local migration in `src/db/migrations.ts`, `addColumnIfMissing`): `farm_name` alone can't group parcels by farm (two farms can share a name); filled from REST/local-create, never from pull.
- **Map bridge fix**: `SET_PARCELS`/`SET_DESTINATIONS` now fire even on an empty list (they're what trigger `clearLayers()` in the WebView) — short-circuiting on `.length === 0` left deleted parcels'/depots' polygons painted forever. `FIT_BOUNDS` now fires once (`didFitRef`), not on every background refetch under the user's finger.
- **`triggerSync()`** is called from `map.tsx`'s `handleSaveParcel` after a local write, so the push leaves in ~1 s instead of waiting out the 15-min WorkManager floor. `useSync()`'s post-pull invalidation now also invalidates `PARCELS_LOCAL_KEY`/`PARCELS_REFRESH_KEY`/`DEPOTS_LOCAL_KEY`/`DEPOTS_REFRESH_KEY` (previously only `trips`/`bale-loads`/`operator-stats`).
- **`src/utils/geo-area.ts`** (new): `polygonAreaHectares(geojson)` — computes a GeoJSON `Polygon`/`MultiPolygon` area on-device via the WGS-84 **authalic (equal-area) latitude** projected onto a sphere (~0.009% error vs PostGIS `ST_Area(geography)`; a naive mean-radius sphere is off ~0.25%, enough for phone and web to visibly disagree). Used so a freshly-drawn, not-yet-synced field shows a real hectare figure instead of "— ha"; the server's PostGIS value overwrites it on the next background refresh.

Any local write to `parcels` / `delivery_destinations` must invalidate `PARCELS_LOCAL_KEY` / `DEPOTS_LOCAL_KEY` (see CLAUDE.md).

### PointPicker (`src/components/map/PointPicker.tsx`) (Plan A)

2D satellite tile map with a centered pin mechanism (like Google Earth point placement, not a 3D globe). A round pin is fixed at the viewport center; the user pans the map under it. An "Add point" button commits the center coordinate as a new geofence vertex. Used by `geofence-maker` role to build parcel boundaries interactively.

**Feature-gated (`geo.draw_mobile`, `uiOnly`, `e275b3c`, see [[feature-toggles]])**: only the entry-point FABs on `(geofence-maker)/map.tsx` that set `drawMode` are gated (`{!drawMode && drawEnabled && (...)}`). With the entry point unreachable, `drawMode` stays `null` for the whole session, so the point-by-point vertex controls and both create modals (parcel/deposit) are dead by construction — no need to gate them individually. Unlike `depot.inventory` above, the tab itself is **not** hidden — the map remains a valid READ surface showing existing parcels/depots when drawing is off. The idle banner swaps to the new `geofenceMap.bannerDrawDisabled` i18n key instead of `geofenceMap.bannerIdle` when the flag is off.

### Heartbeat (`src/lib/heartbeat.ts`) (Plan C)

Sends `POST /api/v1/profile/heartbeat` roughly every 60-65 seconds (was 30 s; jittered `60_000 + random(5_000)` ms to desync the ~30-phone fleet) while the app is running. Updates `users.last_seen_at` on the server. Used by `UserPresenceDot` in admin-web to show online status.

**Self-dedup gate**: `sendHeartbeatOnce()` reads the last-success timestamp (`health-state.ts`) and skips the POST if one landed within the last 55 s. Both drivers — the JS `setInterval` here and the native-alarm-triggered `presenceCheckin()` call (`presence-checkin-task.ts`) — share this same function, so a JS tick and a native alarm tick landing close together don't double-send. A failed send never stamps, so retries continue on every driver's tick regardless of the gate.

**Background behavior differs by build variant:**

| Condition | Heartbeat on background |
|---|---|
| Non-device-owner install (standard APK) | Stopped on `AppState` `'background'` to save battery; resumed when foregrounded |
| Device-owner install (`isDeviceOwnerResolved()` is true) | Kept running — a foreground service holds the JS thread alive, so the heartbeat continues with the screen off |

The `AppState` `'background'` handler checks `isDeviceOwnerResolved()` (synchronous, memoized — no bridge round-trip) before deciding whether to call `stopHeartbeat()`.

### PresenceService — native keep-alive FGS (device-owner only)

`PresenceService` (`com.strawboss.mobile.PresenceService`, generated by `plugins/withDeviceOwner.js`) is a native Android **`specialUse` foreground service** (type `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+). It holds the app process at foreground importance so the OS does not freeze the JS thread when backgrounded.

- **Channel**: `strawboss-presence`, importance `IMPORTANCE_MIN` (silent, no badge), notification text "StrawBoss activ / Aplicația rulează în fundal."
- **START_STICKY** — the OS restarts the service if it is killed.
- **When started**: on device-owner builds for roles **without** an assigned machine (`geofence_maker`, `depot_manager`). Started from `_layout.tsx` after profile load.
- **When stopped**: roles with an assigned machine skip this service — they already keep JS alive via the GPS location foreground service, which avoids a redundant persistent notification.
- **Non-device-owner / iOS / Expo Go**: `startPresenceService()` / `stopPresenceService()` are no-ops (native module absent).
- **Required permission** in `app.json`: `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`.

JS bindings are in `src/lib/device-owner.ts`: `startPresenceService()`, `stopPresenceService()`, and the synchronous `isDeviceOwnerResolved()` getter (returns the memoized value without a bridge call).

### Map bridge protocol (`src/map/map-bridge.ts`)

**Commands (RN -> WebView):**
- `SET_PARCELS` -- array of `ParcelMapData` with boundaries
- `SET_DESTINATIONS` -- array of `DestinationMapData`
- `SET_MACHINES` -- array of `MachineMarkerData` with lat/lon
- `SET_USER_LOCATION` -- user's GPS dot
- `SET_ROUTE` -- OSRM route polyline with distance/duration
- `CLEAR_ROUTE` -- remove route overlay
- `HIGHLIGHT_PARCEL` -- select a parcel
- `FIT_BOUNDS` -- auto-zoom to all features
- `CENTER_ON` -- fly to specific coordinates

**Events (WebView -> RN):**
- `PARCEL_TAPPED` -- `{ parcelId, parcelName }`
- `DESTINATION_TAPPED` -- `{ destinationId, destinationName }`
- `MAP_READY` -- WebView initialized

`serializeCommand()` wraps command as `window.handleCommand(JSON.stringify(cmd))`. `parseEvent()` parses postMessage JSON.

---

## Fleet Management + OTA Self-Update

### Overview

No new npm dependencies were added. The entire feature is built on existing packages (`expo-secure-store`, `expo-file-system/legacy`, `expo-notifications`, `@strawboss/api`, `@strawboss/types`) plus the expanded native `DeviceOwner` module in `plugins/withDeviceOwner.js`.

### Device Identity (`src/lib/device-checkin.ts`)

Each install generates a **stable device UUID** on first run via `ensureDeviceId()`. The value is created with `generateUuid()`, persisted to SecureStore under `strawboss.device_id`, and never regenerated. The server's **HMAC device token** (returned on first check-in) is stored under `strawboss.device_token`. Both keys survive APK updates and cold reboots.

SecureStore key layout:

| Key | Content |
|---|---|
| `strawboss.device_id` | Stable device UUID (created once, never changes) |
| `strawboss.device_token` | HMAC token issued by server on first check-in |
| `strawboss.ota_mirror` | JSON-serialised `OtaMirror` (current OTA deployment state) |
| `strawboss.pending_install_deployment_id` | Set just before `installApkSilent()` so post-restart boot-rearm can report `installed` |

### Fleet Check-in (`runDeviceCheckin()`)

`runDeviceCheckin()` in `src/lib/device-checkin.ts` is a **public, pre-login** call — the dedicated `fleetApiClient` sends **no `Authorization` header** (`getToken: async () => null`), so fleet telemetry and OTA delivery work even before an operator logs in.

The function:
1. Reads/creates the stable `deviceUuid` and any persisted `deviceToken` via `ensureDeviceId()`.
2. Collects app version (`Constants.expoConfig.version` / `android.versionCode`), hardware info (`getDeviceHardwareInfo()`), raw FCM push token (best-effort), device-owner flag, active-trip flag, and any pending OTA progress reports from the local `OtaMirror`.
3. POSTs to `POST /api/v1/fleet/checkin` (unauthenticated).
4. If `response.deviceTokenIssued` is set, persists it to `strawboss.device_token`.
5. Clears sent OTA reports from the local mirror.
6. If `response.pendingDeployment` is present, calls `handlePendingDeployment()`.

The function is **fire-and-forget**: errors are logged at `warn` but never thrown.

**Trigger points:**

| Context | Trigger |
|---|---|
| Foreground (`_layout.tsx` `AuthGate`) | On mount + every 60 s (`setInterval`) — unconditional, outside the auth check. Each call is subject to the temporal gate below unless forced. |
| 15-min WorkManager background cycle (`run-background-sync.ts`) | Called at the **top** of `runBackgroundSyncCycle()` BEFORE the `!token` guard, so OTA works headless |
| Push notification of type `ota_checkin` | Spread over a random 0-20 s delay (thundering-herd protection for a broadcast push that fans out to the whole fleet near-simultaneously), then `runDeviceCheckin({ force: true })` — bypasses the gate since acceleration is the deliberate point |
| Push notification of type `presence_wake` (FCM data message) | `REMOTE_NOTIFICATION_TASK` re-asserts the native presence anchor then calls `presenceCheckin()` — see "FCM data-wake" below |
| Boot / `MY_PACKAGE_REPLACED` (`boot-rearm.ts`) | Called at the top of `bootRearm()` when `strawboss.pending_install_deployment_id` is set (post-OTA re-report, Part 4) |

### Temporal gate (`runDeviceCheckin(opts?: { force?: boolean })`, traffic diet, Jul 2026)

Check-in is deliberately driven by **four redundant, independent drivers**: the JS `setInterval` above, the location-FGS piggyback, the background-sync piggyback, and the native `AlarmManager` headless task (see `apps/mobile/FLEET-BACKGROUND-ONLINE.md`) — because HONOR/MagicOS pauses the JS runtime and OEM-kills services, no single driver is reliable alone, and **none of the four should ever be removed**.

What's new: unless `opts.force` is set, `runDeviceCheckin()` reads the last-SUCCESS timestamp persisted by `markCheckinSuccess()` (`health-state.ts`, SecureStore-backed, shared with the native headless-task JS context) and skips the network round-trip entirely if a success landed within `CHECKIN_GATE_MS = 90_000` ms (±10% jitter). The stamp is written **only on success**, never on a mere attempt, so a phone with flaky network still retries on every driver's tick — the failover redundancy is unchanged; only the redundant *network calls* on an already-healthy phone are cut.

### FCM data-wake (`src/lib/remote-notification-task.ts`, new, vc40+)

Deep Doze throttles the native `AlarmManager` anchor to the OS's maintenance windows (1-4 h apart the longer a phone sits idle), which alone can't hold the ~90 s presence gate above — measured on-device gaps of 26-73 min overnight. High-priority FCM **data** messages are the one signal that reliably pierces Doze.

- Backend: `QUEUE_PRESENCE_DEADMAN` (BullMQ, every 2 min, `fleet-push.service.ts`) sends `{ type: 'presence_wake' }` (`android.priority=high`) to any device-owner phone whose last check-in has gone stale. Requires `FIREBASE_SERVICE_ACCOUNT_FILE` (backend concern — see [[backend]]).
- `REMOTE_NOTIFICATION_TASK = 'strawboss-remote-notification'` is **defined at the bundle entry** (`register-background-tasks.ts`, imported from `index.js`) so the headless runtime can resolve the task key with no Activity mounted — defining it only inside `_layout.tsx` would leave a freshly-OTA'd, never-foregrounded phone with no persisted task registration for its first wake. `Notifications.registerTaskAsync(REMOTE_NOTIFICATION_TASK)` runs both at module scope here (headless-safe, fixed in commit `3ad81c3` after it was found missing) AND from `_layout.tsx`'s `AuthGate` effect (`registerBackgroundNotificationTask()` in `src/lib/notifications.ts`, unconditional on mount, best-effort) as redundant reinforcement.
- `extractWakeType()` parses the expo-notifications task payload (data-message shape `{ data: { type } }` or `{ data: { dataString: '<json>' } }`; ignores notification-response payloads carrying `actionIdentifier`) and reacts only to `WAKE_TYPES = new Set(['presence_wake', 'ota_checkin'])`.
- On a matching wake: (1) if `isDeviceOwner()`, calls `startPresenceService()` to re-assert the native FGS/alarm anchor first — a bare check-in alone leaves the phone dependent on the next (throttled) alarm — then (2) calls `presenceCheckin()`, the identical function the native alarm tick calls, so a wake and an alarm tick are indistinguishable downstream (one source of truth).

### OTA Orchestrator (`handlePendingDeployment()`)

When the check-in response includes a `PendingDeployment`, the orchestrator steps through a state machine persisted in `strawboss.ota_mirror` (type `OtaMirror`):

```
pending / notified
  → downloading   (expo-file-system downloadAsync to DocumentDirectory)
  → downloaded
  → awaiting_idle (if mid-trip and installPolicy.forceNow is false)
  → installing    (installApkSilent — process typically killed here)
  → installed     (only reached if process survives, or on next boot-rearm check-in)
  → failed        (max 3 attempts then gives up)
```

Key behaviours:

- **Already up-to-date guard**: if `Constants.expoConfig.android.versionCode >= deployment.versionCode`, any mirror for that deployment is flushed as `installed` and cleared immediately.
- **Download**: `FileSystem.downloadAsync(fullUrl, destUri)` saves to `DocumentDirectory/strawboss-ota-{deploymentId}.apk`. HTTP status other than 200 transitions to `failed`.
- **SHA-256 verify**: the native `installApkSilent` method computes the digest before opening a `PackageInstaller` session; a mismatch rejects with `SHA_MISMATCH` and no install proceeds.
- **Idle gate**: `hasActiveTrip()` queries `TripsRepo.listActive()` (local SQLite — offline-safe). If active trips exist and `installPolicy.forceNow` is false, the orchestrator records `awaiting_idle` and returns without installing. The next check-in re-evaluates.
- **Install**: `PENDING_INSTALL_DEPLOYMENT_ID_KEY` is written to SecureStore **before** calling `installApkSilent()` because the process is killed when Android replaces the APK. `installApkSilent` opens a `PackageInstaller.Session`, streams the APK, fsyncs, and calls `session.commit()`.
- **Max attempts**: `MAX_INSTALL_ATTEMPTS = 3`. If `mirror.attempt >= 3` and state is `failed`, the orchestrator logs a warning and stops trying.
- **Reports**: each state transition appends a `DeviceOtaReport` to `mirror.reports`. Reports are batched and sent on the next check-in's `otaReports` field, then cleared from the mirror.

### Post-Restart Re-Report (`src/lib/boot-rearm.ts`)

On `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`, the headless `bootRearm()` task (Part 4) checks for `strawboss.pending_install_deployment_id` **before** any auth guard. If the key exists, it calls `runDeviceCheckin()` — the new build's `versionCode` in `Constants.expoConfig` serves as proof of successful installation. The key is then deleted regardless of outcome.

### Mobile Log Upload now includes `deviceId`

`uploadTodayMobileLogs()` in `src/sync/mobile-log-upload.ts` calls `ensureDeviceId()` and includes `deviceId: deviceUuid` in the `POST /api/v1/logs/mobile` payload. This makes pre-login device logs attributable per physical device on the server side.

### Native `DeviceOwner` Module additions (`plugins/withDeviceOwner.js`)

All `@ReactMethod` entries live in the generated `DeviceOwnerModule.kt`. The full set relevant to fleet management:

| Method | Signature | Description |
|---|---|---|
| `getDeviceHardwareInfo` | `(Promise)` → `{ model, manufacturer, osVersion, androidId }` | Returns `Build.MODEL`, `Build.MANUFACTURER`, `Build.VERSION.RELEASE`, and `Settings.Secure.ANDROID_ID`. No dangerous permission required. Always returns a map; fields are empty strings on failure. |
| `installApkSilent` | `(path: String, expectedSha256: String, Promise)` → `Boolean` | SHA-256 verifies the APK at `path`, opens a `PackageInstaller.Session(MODE_FULL_INSTALL)`, streams the APK, fsyncs, and calls `session.commit()` via a `PendingIntent` targeting `InstallResultReceiver`. Rejects with `SHA_MISMATCH` on digest failure, `FILE_NOT_FOUND` if the file is absent, `DO_INSTALL` on session errors. |
| `isPackageInstalled` | `(packageName: String, Promise)` → `Boolean` | Calls `PackageManager.getPackageInfo()`. Returns `true` if installed, `false` on `NameNotFoundException`. Never throws to JS. |
| `setTailscaleManaged` | `(authKey: String, hostname: String, tailnet: String, Promise)` → `Boolean` | Pushes App Restrictions to `com.tailscale.ipn` (`AuthKey`, `Hostname`, `Tailnet`, `AlwaysOn.Enabled=true`) via `DevicePolicyManager.setApplicationRestrictions()`, then calls `setAlwaysOnVpnPackage(admin, "com.tailscale.ipn", false)`. Requires API 24+. Rejects with `TS_NOT_INSTALLED` if the Tailscale app is absent, `SDK_TOO_LOW` on API < 24. |
| `clearTailscaleManaged` | `(Promise)` → `Boolean` | Calls `setAlwaysOnVpnPackage(admin, null, false)` and pushes `AlwaysOn.Enabled=false` App Restrictions. Disables always-on VPN without uninstalling the app. |

**tsnet is NOT available on Android.** Control of Tailscale is always via the official `com.tailscale.ipn` app's MDM layer (App Restrictions + `setAlwaysOnVpnPackage`).

`InstallResultReceiver` (a `BroadcastReceiver`, `android:exported="false"`) receives `PackageInstaller` session status broadcasts and logs the result. Best-effort only — JS promise resolves before the broadcast fires.

**Manifest entries** added by `withManifest()`:
- `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>` — required for `PackageInstaller` session commits on API 26+.
- `<receiver android:name=".InstallResultReceiver" android:exported="false"/>` — receives silent install result broadcasts.

### JS wrappers in `src/lib/device-owner.ts`

All native methods have typed JS wrappers that return `false` / `{}` when the native module is absent (iOS / Expo Go) and never throw:

- `getDeviceHardwareInfo()`: returns `{ model?, manufacturer?, osVersion?, androidId? }`. Returns `{}` on iOS / Expo Go.
- `installApkSilent(absolutePath, expectedSha256)`: returns `Promise<boolean>`. Callers must persist install state before awaiting (process is killed during self-update).
- `isPackageInstalled(packageName)`: returns `Promise<boolean>`. Returns `false` defensively on iOS / Expo Go or unexpected error.
- `setTailscaleManaged(authKey, hostname, tailnet)`: returns `Promise<boolean>`. Returns `false` and logs when the module is absent or Tailscale app is not installed.
- `clearTailscaleManaged()`: returns `Promise<boolean>`. Returns `false` and logs when the module is absent.

### SecureStore keys added for Tailscale + command reports

| Key | Content |
|---|---|
| `strawboss.command_reports` | JSON array of `DeviceCommandReport[]` pending delivery to the server |
| `strawboss.tailscale_state` | Last-applied Tailscale action: `'up'` \| `'down'` \| absent |

### Tailscale remote control — command handler (`handleTailscaleCommand()`)

When `runDeviceCheckin()` receives a `DeviceCheckinResponse` with `pendingCommand.type === 'tailscale'`, it calls `handleTailscaleCommand(command)` in `src/lib/device-checkin.ts`.

Flow for `action === 'up'`:

1. Check `strawboss.tailscale_state`. If already `'up'`, skip the native call and push a success report (idempotent).
2. Call `isPackageInstalled('com.tailscale.ipn')`.
3. **Zero-touch auto-install** — if Tailscale is NOT installed and `command.payload.tailscaleApk` is present (`{ url, sha256 }`):
   a. Download the APK from `${API_URL}${apkRef.url}` to `DocumentDirectory/tailscale-install.apk` using `FileSystem.downloadAsync`.
   b. Verify HTTP status 200; throw on failure.
   c. Call `installApkSilent(downloadResult.uri, apkRef.sha256)` — SHA-256-verified, silent Device Owner install.
   d. If `!installed` throw — result is reported as failure.
4. Call `setTailscaleManaged(payload.authKey, payload.hostname, payload.tailnet)`.
5. Write `'up'` to `strawboss.tailscale_state`.
6. Append a `DeviceCommandReport { commandId, status: 'success' }` to `strawboss.command_reports`.

Flow for `action === 'down'`:

1. Check `strawboss.tailscale_state`. If already `'down'`, skip and report success.
2. Call `clearTailscaleManaged()`.
3. Write `'down'` to `strawboss.tailscale_state`.
4. Append success report.

On any failure in either branch, a failure report `{ commandId, status: 'failure', error }` is appended. The handler is defensive — it never throws out to the caller.

**Report delivery**: `commandReports[]` are included in the `DeviceCheckinRequest` body on the next check-in. After a successful POST, `clearCommandReports()` deletes `strawboss.command_reports` from SecureStore.

**No new npm dependencies** — the auto-install reuses the existing `installApkSilent` native method and `expo-file-system/legacy` `downloadAsync`.

---

## Location Tracking

### useLocationTracking (`src/hooks/useLocationTracking.ts`)

- `startTracking(machineId)`: requests foreground permission via `requestLocationPermission()`, starts `startLocationWatcher()` from `src/lib/location.ts`
- Each GPS update POSTs to `POST /api/v1/location/report` with `{ machineId, lat, lon, accuracyM, headingDeg, speedMs, recordedAt }` — this single-report foreground path is unaffected by the background batching below
- Returns `{ isTracking, error, lastReportedAt, startTracking, stopTracking }`
- All errors and successes logged via `mobileLogger`

### Background batching (`src/lib/location.ts`, traffic diet F2, Jul 2026)

The `TaskManager` background location task (`LOCATION_UPDATES_TASK_NAME`) no longer POSTs each GPS fix immediately. It appends every fix to the on-disk pending-reports outbox (`appendPendingReport`) unconditionally; a separate gate decides when to actually flush to the network:

- **`maybeFlushBatchedLocationReports()`**: a gate persisted to disk (`LAST_FLUSH_ATTEMPT_FILE`, not a module var — this task can resume in a fresh JS context after an OEM freeze / HeadlessJS cold-start) limits flush *attempts* to once per `BACKGROUND_FLUSH_MIN_INTERVAL_MS = 60_000` ms, independent of the 20-30 s GPS capture cadence (unchanged). Both the location background task and the presence-checkin-task's piggyback flush (`presence-checkin-task.ts`) now call this instead of `flushPendingLocationReports()` directly, so they share the same ~60 s floor.
- **Batch transport**: `flushPendingLocationReportsBatched()` sends chunks of `BATCH_CHUNK_SIZE = 30` via `POST /api/v1/location/report/batch` (`{ reports: [...] }`), persisting the outbox after **each chunk** — same crash-safety guarantee as before (a freeze mid-flush resumes from where it left off, never replays).
- **Rollout fallback**: a 404/405 from the batch endpoint (`isBatchUnsupportedError`) flips a module-level `batchUnsupported` flag permanently for the process lifetime; every subsequent flush (this one included, for the remainder) falls back to `flushPendingLocationReportsSingle()` — the original one-POST-per-report loop — so an old backend mid-rollout still works.
- **Permanent-failure handling**: `isBatchPermanentDropError()` (400/403 only — narrower than the single-report path's `isPermanentReportError`, which also treats other 4xx as permanent) drops the whole chunk from the outbox; anything else (401/408/429/5xx) is treated as transient and stops the loop, keeping the rest queued.
- Net effect: ~150 GPS fixes/hour/phone collapse to roughly one batched POST per minute per phone instead of one POST per fix.

### Adaptive background sync piggyback (`maybePiggybackSync()`)

Background piggyback sync interval is now trip-state-adaptive, not a flat value:

| State | Interval |
|---|---|
| Foreground (`AppState === 'active'`) | 120 000 ms (`PIGGYBACK_SYNC_MIN_INTERVAL_FG_MS`, unchanged) |
| Background, active trip | 60 000 ms (`PIGGYBACK_SYNC_MIN_INTERVAL_BG_ACTIVE_TRIP_MS`) |
| Background, no active trip | 180 000 ms (`PIGGYBACK_SYNC_MIN_INTERVAL_BG_IDLE_MS`) |

`hasActiveTripCached()` wraps `hasActiveTrip()` (now exported from `src/lib/device-checkin.ts` for this reuse) with a 60 s in-memory TTL cache so a background tick every 20-30 s doesn't hit SQLite on every wake. Both this throttle and the presence-checkin throttle (`PIGGYBACK_CHECKIN_MIN_INTERVAL_MS = 55_000`) now apply a ±10% jitter to desync the ~30-phone fleet from synchronized request bursts.

---

## Task List

### useMyTasks (`src/hooks/useMyTasks.ts`)

- Fetches `GET /api/v1/task-assignments/daily-plan/{today}` (returns `DailyPlanResponse` with `available`, `inProgress[]`, `done`)
- Collects all assignments, filters client-side by `assignedUserId`
- Sorts by `sequenceOrder`
- Refetches every 60 seconds (was 30 s — traffic diet cadence pass, see "Polling cadence" under Sync Details)
- Returns `{ tasks: MyTask[], isLoading, error, refetch }`

### TaskList component (`src/components/shared/TaskList.tsx`)

Renders the filtered task list with parcel names, machine codes, status pills. Each task card links to the appropriate flow (production, loading, delivery).

---

## Loader Board (Assignment-Aware Trucks Card)

Reworked 2026-07-24. The loader home (`app/(loader)/index.tsx`) used to be purely GPS-proximity-based (`useTrucksAtLoader`, keyed on nothing but distance from the loader machine — deleted, commit `d842737`, zero remaining importers in `apps/mobile`; the `packages/api` hook and the backend `/location/trucks-at-loader` route stay, still used elsewhere). It is now assignment-aware, keyed on `trips.loader_id` (not `loader_operator_id`).

### useLoaderBoard (`src/hooks/useLoaderBoard.ts`, new)

Polls `GET /api/v1/location/loader-board/:loaderMachineId` (`@Roles(admin, loader_operator)`, org-scoped) every 15 s by default (`pollMs`), disabled when no machine id is available — same shape as the old `useTrucksAtLoader`. Optional `radiusM` (default 75) / `windowMinutes` (default 15) query params. Returns `LoaderBoardResponse` (`packages/api/src/hooks/use-trucks-at-loader.ts`):

```ts
interface LoaderBoardResponse {
  assigned: AssignedTruck[];         // trips.loader_id === this machine, still to-load
  nearbyUnassigned: TruckAtLoader[]; // GPS-proximity trucks NOT in `assigned`
}
```

`AssignedTruck.presence` is `'here' | 'enroute' | 'loaded' | 'unknown'` (`'here'` = within radius; `'enroute'` = has GPS but outside radius; `'unknown'` = no recent GPS ping; `'loaded'` = the trip's load is already done) plus a `distanceM` (null if no recent GPS) and `tripStatus: 'planned' | 'loading' | 'loaded'`.

### Loader home card (`app/(loader)/index.tsx`)

- **Assigned section** (`sectionAssignedTrucks`, header shows a live count): `board.data.assigned` sorted by presence rank (`here` < `enroute`/`unknown` < `loaded`) then by `distanceM`, **UI-merged** with `auxTrips.data` (auxiliary/external-transporter loads) into one "trucks to load" list/count — `AssignedTruckCard` renders a presence badge (`badgeHereNow`/`badgeEnroute`/`badgePresenceLoaded`) + optional field name; aux trucks still render via the existing `AuxTruckCard`.
- **Nearby-unassigned section** (`sectionNearbyUnassigned`, collapsible, `nearbyOpen` state, default open): `board.data.nearbyUnassigned`, dimmed (`opacity: 0.55`) `TruckCard`s tagged `tagUnassigned` — trucks merely in GPS range that dispatch has not assigned to this loader.
- i18n: new `loader.home.*` keys (`sectionAssignedTrucks`, `sectionNearbyUnassigned`, `noAssignedTrucksTitle/Subtitle`, `badgeHereNow`, `badgeEnroute`, `badgePresenceLoaded`, `fieldPrefix`, `tagUnassigned`, `distanceMeters`, `distanceKm`) in `src/i18n/en.ts` / `ro.ts`.

---

## Feature Flows

### ProductionFlow (`src/components/features/production/ProductionFlow.tsx`)
**Steps**: info -> count -> confirm
- **info**: shows current parcel name, "Comenzi productie" button
- **count**: `NumericPad` for bale count entry (max 4 digits)
- **confirm**: `ProductionConfirmation` with summary and confirm/back
- **Save**: creates local `bale_productions` record + enqueues sync with `idempotency_key: bale_production_{id}`

### EnhancedDeliveryFlow (`src/components/features/delivery/EnhancedDeliveryFlow.tsx`)

The only delivery flow left — the original `DeliveryFlow.tsx`/`SignatureStep.tsx` were removed; every driver-delivery entry point (`app/(driver)/delivery.tsx` → `app/driver-ops/delivery-flow.tsx`) renders `EnhancedDeliveryFlow` directly. **2 steps** (`TOTAL_STEPS = 2`, was 3 through 2026-07-24):

- **Step 0 — weighing**: `WeightInput` (gross/tare), wrapped in a `ScrollView` so the continue button is reachable on small screens. A **"Livrează fără cântărire"** button (`handleDeliverWithoutWeighing()`, confirm modal) sets `scaleBroken = true` and skips straight to step 1 with both weights blanked — for a depot with no working scale, mirroring the depot operator's own `confirmDepotDelivery` `scaleBroken` path. Replaces a removed "Contact via WhatsApp" button (`WhatsAppLink.tsx`, deleted — commit `b85cbd0`).
- **Step 1 — confirmation**: `CmrConfirmation` — summary of bales/weights (rows read "Fără cântărire" when `scaleBroken`)/receiver, with an FM-6 countdown before the irreversible confirm. **No receiver-signature step or field** (commit `b6beb2e`, 2026-07-24): a failed signature binary upload could leave a payload that could never pass `signatureUrlSchema`, permanently stuck-retrying the `complete` transition in the sync queue with quadratic backoff. `CompleteDto`/`completeSchema` no longer accept `receiverSignature` at all (not just optional) so an already-queued bad payload from an older build is silently stripped by zod instead of rejected forever.
- **Save**: `confirm-delivery` sends `{ grossWeightKg, tareWeightKg, deterioratedBalesCount: null, scaleBroken }` (both weights `null` when `scaleBroken`); `complete` sends only `{ receiverName }`. Backend `trips.service.ts` requires a positive `grossWeightKg` unless `scaleBroken === true`, in which case `gross_weight_kg`/`tare_weight_kg` stay `NULL` and `trips.scale_broken` is set.

### LoadingFlow (`src/components/features/loading/LoadingFlow.tsx`)
**Steps**: scan -> count -> confirm
- **scan**: `QRScanner` to identify the machine
- **count**: `BaleCountInput` for number of bales loaded
- **confirm**: `LoadConfirmation` summary
- **Save**: creates local operation, updates trip to `loaded`, enqueues sync

### FuelEntryFlow (`src/components/features/fuel/FuelEntryFlow.tsx`)
**Steps**: liters -> station-photo -> confirm (Plan C/T17 simplified flow — dropped receipt OCR and a separate odometer step; corrected from a stale earlier version of this doc)
- **liters**: `NumericPad` (6 digits, decimal support)
- **station-photo**: `PhotoCapture`, audit-only photo of the fuel station (no OCR, no receipt/bon fiscal)
- **confirm**: summary card with all values
- **Save**: creates local `fuel_logs` record + enqueues sync

**Feature-gated (`costs.receipt_photos`, `uiOnly`, `e275b3c`, see [[feature-toggles]])**: `stepsFor(photosEnabled)` derives the walked step list by filtering `'station-photo'` out of the fixed `FUEL_STEP_ORDER` array when the org has the flag off; both `StepIndicator`'s `totalSteps` and the current `stepIndex` are computed from this derived array, so no index arithmetic is needed elsewhere. Only the three hardcoded `goToStep('station-photo')` call sites needed rewriting, to target `'confirm'` or `'liters'` instead. The photo step is mandatory today (no partial state) — disabling the flag simply means it's never asked for.

### ConsumableFlow (`src/components/features/consumables/ConsumableFlow.tsx`)
**Steps**: type -> quantity -> photo -> confirm
- **type**: `ConsumableTypeSelector` (diesel or twine)
- **quantity**: `NumericPad` (liters for diesel, kg for twine)
- **photo**: `PhotoCapture` for receipt (optional)
- **confirm**: `ConsumableConfirmation` summary
- **Save**: creates `fuel_logs` (diesel) or `consumable_logs` (twine) + enqueues sync

---

## CMR Scan (Auxiliary Loads)

New (Jul 2026). Auxiliary (external-transporter) loads finish on a **scanned paper CMR** instead of the specimen signature used for own-fleet loads — there is no paper CMR for a truck that never leaves the company. Entry point: `app/loader-ops/load-bales.tsx`; `proceedToFinish()` branches to `cmrStep: 'intro'` when `isAuxiliary`, else `setShowSignature(true)` (own-fleet path unchanged).

### Screen state machine (`cmrStep: null | 'intro' | 'preview' | 'saving'`)

1. **intro/preview**: `handleScanPages()` opens the ML Kit document scanner (`scanCmrPages()` in `src/lib/cmrScanner.ts` — live edge detection, auto-crop, up to `MAX_PAGES = 10` pages, quality 80). Falls back to a plain camera shot (`captureCmrPageWithCamera()`, via `expo-image-picker`) when the scanner module throws `ScannerUnavailableError` — the operator is offered a "Take a photo" fallback rather than being trapped, since the scan is mandatory to finish an aux load.
2. Captured pages accumulate in `cmrPages` (local image URIs); the preview screen is the mandatory gate — no "Confirm and send" button renders with zero pages, and pages can be individually removed.
3. **`handleCmrConfirm()`**: builds the PDF **before** anything is written (`buildCmrPdf()`), so a scanner/render failure never leaves a registered load without a CMR — the operator stays on the preview and can just retry. Offline, refuses to proceed unless `auxTripId` is available (carried in via route params from the loader home's aux truck card — online it could be read off the register-load response, but there is no response offline).
4. **`submitLoad()`** (renamed from `handleSignatureConfirm`, now shared by both finish paths): registers the load; own-fleet passes `loaderSignature`, aux passes `cmr: { uri, pageCount, scanId }` — exactly one is ever set. `loaderSignature` is optional in the server's Zod schema, so aux loads simply omit it and `trips.loader_signature_url` stays null.

### PDF build (`buildCmrPdf()`, `src/lib/cmrScanUpload.ts`, new)

- Downscales each page to `PAGE_MAX_WIDTH = 1600` px, JPEG quality `0.7` (`expo-image-manipulator`) before base64-inlining into HTML — a raw 12 MP page is ~8 MB and `expo-print`'s WebView reliably OOMs on a low-end fleet phone without this.
- Renders one paginated A4 PDF (`A4_WIDTH_PT/HEIGHT_PT = 595 x 842`) via `expo-print`'s `printToFileAsync`; sets both `page-break-after` and the modern `break-after` CSS (the Android WebView print path only honours the older property) with a `:last-child` reset so the PDF doesn't end on a blank page.
- Moves the PDF from `expo-print`'s cache dir into `DocumentDirectory/cmr-scans/` — cache is evictable under Android storage pressure and a scan queued offline can sit for days waiting for signal.
- Mints a stable `scanId` (UUID) once, reused across every upload retry of the same PDF — the server keys the storage filename on it, so an ambiguous-failure retry overwrites the same blob instead of orphaning one on disk.
- Deletes the intermediate `ImageManipulator` output copies immediately after encoding; `deleteLocalCmrImages()` deletes the original captured source pages once the PDF has been sent or queued (otherwise every load leaves a stack of transport-document photos — driver name, plates, signatures — in app storage forever).

### Upload & sync queue integration

- **Online**: `uploadCmrScan(tripId, uri, pageCount, scanId)` POSTs multipart to `POST /api/v1/cmr-scans/trip/:tripId`. On failure, the load registration is **not** rolled back — the scan is queued instead (`enqueueCmrScan`) and drained by the sync loop; `mobileLogger.flow` records the fallback.
- **Offline**: the `register_load` sync-queue entry is now enqueued with `action: 'insert'` (fixed a bug where it used `'register'` — `sync_queue` has `CHECK (action IN ('insert','update','delete'))`, enforced by SQLite, so the old value threw on `enqueue()` and the load was silently never queued). The `cmr_scan` entry is enqueued **after** it (FIFO dequeue order) and carries `registerLoadIdempotencyKey` so `push.ts` can defer a scan whose sibling `register_load` failed this sync cycle (`failedRegisterLoads` set in `pushMutations()`), letting the pair recover together on the next retry.
- `cmr_scan` is a new entry in `DIRECT_ENDPOINT_TYPES` (`src/sync/push.ts`) — a multipart file upload to its own endpoint, not a row in any syncable table. `sendCmrScan()` stats the local PDF first (a missing file — e.g. app data cleared — fails only that one entry, not the whole dequeued batch of up to 50) then uploads and deletes the local copy on success. Idempotent server-side by replacement (a retry supersedes rather than duplicates).
- Idempotency key format: `cmr_scan_{uuid}` where `uuid` is a fresh id minted at enqueue time (distinct from `scanId`, the storage-filename id minted at PDF-build time).

### ML Kit pre-fetch (`plugins/withMlKitDocScanner.js`, new)

Expo config plugin adding `com.google.mlkit.vision.DEPENDENCIES = docscanner` meta-data to `AndroidManifest.xml`, asking Play Services to download the scanner module at install time instead of on first use. Best-effort only — needs healthy Play Services and connectivity at install time, which the sideloaded Device-Owner fleet often lacks at first boot, which is exactly why the camera fallback above exists. New npm dependency: `react-native-document-scanner-plugin@2.0.4` (also has an `app.json` config-plugin entry with a `cameraPermission` string).

### i18n

New keys under `loader.loadBales.*` in `src/i18n/en.ts` / `ro.ts`: `cmrScanScreenTitle`, `cmrScanTitle`, `cmrScanHint`, `cmrScanButton`, `cmrScanAddPage`, `cmrScanDeletePage`, `cmrScanPagesLabel`, `cmrScanConfirmButton`, `cmrScanBuildingPdf`, `cmrScanUnavailableTitle/Message`, `cmrScanFallbackPhotoButton`, `cmrScanPdfFailedTitle/Message`, `cmrScanNoTripTitle/Message`.

---

## Sync Details

### Batched logger (`src/lib/logger.ts`)

Writes NDJSON to `DocumentDirectory/strawboss-logs/{category}/{YYYY-MM-DD}.log`. Categories: `all`, `error`, `warn`, `info`, `flow`, `debug`.

**Batching**: `appendLine()` collects lines per file in a `pendingLines` Map, `flushPending()` runs after 2-second debounce to batch-write all pending lines.

**7-day cleanup**: `cleanupOldMobileLogFiles()` lists files in each category dir, deletes `.log` files with dates older than 7 days. Runs on app mount and every `AppState` resume.

### Idempotency keys
Each sync queue entry carries a unique `idempotency_key`. Keys MUST be stable across retries — computed once from the entity UUID and stored (never regenerated from `Date.now()` or `Math.random()`):
- `bale_production_{uuid}` -- baler production records
- `fuel_log_{id}` -- fuel entries
- `consumable_log_{id}` -- consumable entries
- `deliver_{tripId}` -- delivery completion
- `load_{tripId}` -- loading completion
- `cmr_scan_{uuid}` -- CMR scan PDF upload (queued alongside `register_load_{idempotencyKey}`, see CMR Scan section above)

`load-bales.tsx` stabilizes the key by generating it at screen mount and holding it in a `useRef` (H-7 fix, commit `e03b4e4`). The offline `register_load` sync-queue entry's `action` field must be `'insert'` (was buggy `'register'`, which the `sync_queue` CHECK constraint silently rejected — see CMR Scan section above).

### In-flight reset (`SyncQueueRepo.resetInFlight()`)
On sync start, all entries stuck as `in_flight` (from a crashed previous sync) are reset to `pending`. This prevents data loss on interrupted syncs.

### SQL MAX versions
Each repo has `getMaxServerVersion()`: `SELECT MAX(server_version) FROM {table}`. This value is sent during pull to get only newer records. The server returns records with `sync_version > requested` up to LIMIT 1000.

### Mobile log upload gate (`uploadTodayMobileLogs()`, traffic diet, Jul 2026)

Gated to at most once per `MIN_UPLOAD_INTERVAL_MS = 10 min` per phone, unless `options.force` is set (used by the remote `fetch_logs` fleet command, which must bypass the gate for on-demand support requests) or today's pending entries include an `error`/`warn` line (those still ship immediately regardless of cadence). Last-upload timestamp is cached in-memory and persisted to `strawboss-logs/.last-upload-at` so the gate survives app restarts.

### Polling cadence (traffic diet F2/F3, Jul 2026)

Several TanStack Query hooks had their `refetchInterval` widened to cut aggregate request rate across the ~30-phone fleet — all now paired with the `focusManager` wiring in `_layout.tsx` (Navigation section above), so polling also stops entirely once the app backgrounds instead of just slowing down:

| Hook / query | Old | New |
|---|---|---|
| `useTrucksAtLoader` (deleted 2026-07-24, commit `d842737` — see "Loader Board") | 10 s | 15 s (inherited by its replacement, `useLoaderBoard`) |
| `useAuxiliaryTrips` | 15 s | 30 s |
| `useMachineLastLocation` | 30 s | 60 s |
| `useMyTasks` | 30 s | 60 s |
| `useNearbyLoaders` | 30 s | 60 s |
| `MapScreen` related-machines query | 15 s | 30 s |

`(loader)/index.tsx` also dropped its explicit `pollMs` overrides for the trucks hook / `useAuxiliaryTrips()`, now relying on each hook's own (widened) default.

**`useAuxiliaryTrips` scoped to today** (bug fix, commit `54c6e51`): now sends `dateFrom=startOfDayRomaniaISO()` to `GET /api/v1/trips/auxiliary/at-loader/:machineId`, and the query key includes `dateFrom` — stops stale auxiliary trips from prior days piling up on the loader home screen; the cache naturally rolls over at local (Romania) midnight.

**`useMyTrucksToLoad` `include=refs` optimization**: requests `GET /api/v1/trips?...&include=refs` so the backend inlines `truck_registration_plate`/`truck_internal_code`/`source_parcel_name`/`source_parcel_code` directly on each trip row, avoiding a per-truck `/machines/:id` + per-parcel `/parcels/:id` fan-out (N+1). `tripsCarryRefs()` checks whether every trip row actually carries those fields (present, possibly `null`); `undefined` means an older backend mid-rollout doesn't support `include=refs` yet, and the hook transparently falls back to the original parallel fan-out lookups.

---

## Build System

### App config (`app.json`)
- Package: `com.strawboss.mobile`
- Version: `version` / `android.versionCode` are bumped by `scripts/bump-version.mjs` (kept in lockstep with `android/app/build.gradle`'s `versionName`/`versionCode`). Last **committed** values (commit `1ab36c5`, 2026-07-13): `versionCode 43` / `versionName "1.0.39"`. The working tree at last inspection carried a further **uncommitted** local bump to `versionCode 49` / `versionName "1.0.45"` (from an uncommitted `mobile-build-local` run) — check `git status`/`git diff` on `app.json` + `android/app/build.gradle` before trusting either number.
- Plugins: expo-router, expo-camera, expo-image-picker, `react-native-document-scanner-plugin` (CMR scan, config: `cameraPermission`), expo-sqlite, expo-location, expo-notifications, `./plugins/withAlwaysOnTracking`, `./plugins/withDeviceOwner`, `./plugins/withMlKitDocScanner`, `./plugins/withHeadlessProguard` (new — see "R8/Proguard: keep the headless JS app loader" below)
  - `expo-notifications` config: `color: "#0A5C36"` — **no custom sounds declared** (see note below)
- Android permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `CAMERA`, `RECORD_AUDIO`
- iOS: location usage descriptions for when-in-use, always, and both

### R8/Proguard: keep the headless JS app loader (`plugins/withHeadlessProguard.js`, fixed 2026-07-13, commit `1ab36c5`)

**Root cause of the major fleet "always-on" incident** (see `project_r8_strips_headless_loader` in project memory / `apps/mobile/FLEET-BACKGROUND-ONLINE.md`). Release builds run R8 (`enableMinifyInReleaseBuilds` defaults `true`, never overridden). Expo's headless JS app loader is resolved **only via reflection** (`Class.forName("expo.modules.adapters.react.apploader.RNHeadlessAppLoader")` from `AppLoaderProvider`), so R8 sees zero static references and deletes the whole subsystem — confirmed against a shipped APK's `usage.txt` (R8's own removed-code list): `RNHeadlessAppLoader`, `RNHeadlessAppLoader$loadApp$1`, `RNHeadlessAppLoaderKt`, `HeadlessAppLoaderNotifier`, `AppLoaderProvider$Callback`.

**Impact**: every background entry point that needs to run JS with no Activity mounted — `boot-rearm`, the presence-alarm check-in, `expo-background-task` sync, the FCM presence dead-man wake — silently no-ops (`E Expo: Cannot initialize app loader` / `ClassNotFoundException`). The phone becomes a zombie: native health stays perfect (FGS up, battery-opt exempt, WorkManager "Task successfully finished") while **zero JavaScript ever runs**, so `runDeviceCheckin()` never fires and no HTTP request leaves the device — until the UI is opened by hand (which boots JS the normal, non-headless way). Observed live: 6.2 h of zero check-ins on one fleet phone.

**Fix**: `plugins/withHeadlessProguard.js`, a `withDangerousMod` config plugin, appends `-keep` rules to the *generated* `android/app/proguard-rules.pro` on every `expo prebuild` (a hand-edit there is silently clobbered — same reasoning as `withDeviceOwner.js`/`withAlwaysOnTracking.js`). Idempotent via a marker comment. Deliberately surgical — keeps only:
```
expo.modules.adapters.react.apploader.**
expo.modules.apploader.**
expo.modules.taskManager.**
expo.modules.backgroundtask.**
```
R8 also strips much of the rest of `expo.modules.adapters.react.*` (legacy unimodules glue, genuinely dead under the New Architecture), so that tree is **not** blanket-kept and minification stays **on** — the fix is not "disable R8".

### Android notification channels (`src/lib/notifications.ts`)

Registered in `registerForPushNotifications()` via `setNotificationChannelAsync`:

| Channel ID | Name | Importance | Notes |
|---|---|---|---|
| `default` | Default | MAX | Standard app notifications |
| `geofence` | Geofence | HIGH | Parcel entry/exit events |
| `location` | Locație GPS | LOW | Foreground-service GPS indicator; no sound, minimal vibration |
| `baler-exit` | Alertă ieșire câmp | MAX | Baler field-exit alert; bypass DND, vibration `[0, 400, 200, 400]`, red light; `sound: 'baler_exit'` falls back to device default until the WAV asset lands |

**Baler-exit sound status:** `assets/sounds/baler_exit.wav` is **not yet committed**. The `sounds` array was removed from the `expo-notifications` plugin entry in `app.json` because (a) the file was missing and (b) Android resource filenames must be lowercase a-z/digits/underscore — the original `baler-exit.wav` name fails `expo prebuild`. When the WAV is sourced, add `"sounds": ["./assets/sounds/baler_exit.wav"]` back to `app.json` and rebuild. See `apps/mobile/assets/sounds/README-baler-exit.md` for drop-in instructions.

### EAS Build
Cloud builds via Expo Application Services. Profile configured in `eas.json`.

### Local Android build
`./strawboss.sh mobile-build-local` (optional `ANDROID_HOME` env var for SDK path). Produces APK via Gradle.

**Keystore pin hardening (`package.json` `build:apk`, commit `3ad81c3`)**: the script now runs `git checkout -- android/app/debug.keystore` immediately after `expo prebuild --clean --platform android` and before `gradlew assembleRelease`. `prebuild --clean` can otherwise regenerate/overwrite the debug keystore in place, and OTA self-update requires every fielded phone's APK to share the same signer (see the keystore-pin warning in `hot.md` / [[infrastructure]]) — this checkout restores the pinned, git-tracked keystore right before the signing step.

---

## Shared Components

### UI primitives (`src/components/ui/`)
- `BigButton` -- large primary action button with loading state, `variant: 'primary' | 'outline'`
- `NumericPad` -- on-screen numeric keypad with optional decimal support, configurable `maxLength`
- `StatusPill` -- colored status indicator
- `ActionCard` -- card with icon and action button

### Shared (`src/components/shared/`)
- `GeofenceOverlay` -- entry banner + exit confirm modal (see Geofence UX above)
- `OfflineBanner` -- shown when `useNetworkStatus()` reports offline
- `SyncStatusIndicator` -- sync state indicator
- `TaskList` -- daily task list
- `TripProgress` -- visual trip state progress bar
- `QRScanner` -- camera-based QR code scanner
- `PhotoCapture` -- camera capture with preview
- `SignatureCapture` -- touch-based signature pad
- `ParcelSelector` -- dropdown/picker for parcels
- `ConsumableTypeSelector` -- diesel/twine toggle
- `ProblemReportModal` -- report issues
- `AlertBanner` -- generic alert banner

### Stores
- `auth-store` (`src/stores/auth-store.ts`) -- Zustand store: `{ role, userId, assignedMachineId, setProfile, clear }`

### Hooks
- `useSync` (`src/hooks/useSync.ts`) -- wraps SyncManager, triggers on network reconnect / app foreground / 60s interval
- `useNetworkStatus` (`src/hooks/useNetworkStatus.ts`) -- tracks online/offline state
- `useProfile` (`src/hooks/useProfile.ts`) -- fetches and caches user profile
- `useGeofenceNotifications` -- see Geofence UX section
- `useLocationTracking` -- see Location Tracking section
- `useMyTasks` -- see Task List section
- `useCurrentLoaderParcel` -- GPS-based active parcel detection for loader operators. GPS timeout 15s (retry 1x after 5s). Returns status: `locating` | `found` | `not_found` | `multiple_active` | `error`. `multiple_active` means >1 parcels match the GPS position.
- `useDepotInventory` -- fetches depot inventory via `GET /deposit-inventory/:depotId` for the deposit manager role.
- `useLoaderRecallPrompt` -- listens for `loader_recall_prompt` push notifications; surfaces a recall card on the loader home screen.
- `useCachedParcels` / `useCachedDepots` -- local-first: the maps and geofence-maker farm screen render from these (SQLite-backed React Query hooks), with a background REST refresh writing back into SQLite. See "Local-first map cache" under Map Tab.
- `useLoaderBoard` (new, `src/hooks/useLoaderBoard.ts`) -- the loader home's assignment-aware trucks board (`GET /location/loader-board/:machineId`, 15s poll). Replaced `useTrucksAtLoader` on mobile (deleted, commit `d842737`) — see "Loader Board" section.
- `useGeofenceNotifications` -- extended in Plan A to handle new notification types from the geofence-editor workflow.

---

## Related Docs

- [Backend](backend.md) -- sync/push, sync/pull, location/report, notifications endpoints
- [Admin Web](admin-web.md) -- complementary admin dashboard
