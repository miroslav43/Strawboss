# Mobile App (`apps/mobile`)

Expo SDK 54 + Expo Router. Offline-first: all writes go to local SQLite + sync queue, synced to server when online.

---

## Navigation

### Root layout (`app/_layout.tsx`)

1. **Database init**: `getDatabase()` runs SQLite migrations before rendering any routes
2. **AuthGate**: checks Supabase session, fetches profile via `GET /api/v1/profile`, routes to role-specific tab group
3. **Push token registration**: after profile load, calls `registerForPushNotifications()` -> `POST /api/v1/notifications/register-token`
4. **Log cleanup**: runs `cleanupOldMobileLogFiles()` on mount and on each `AppState` resume

### Role-based routing

`ROLE_ROUTES` in `_layout.tsx`:

| Role | Route Group | Layout File |
|---|---|---|
| `baler_operator` | `/(baler)` | `app/(baler)/_layout.tsx` |
| `loader_operator` | `/(loader)` | `app/(loader)/_layout.tsx` |
| `driver` | `/(driver)` | `app/(driver)/_layout.tsx` |
| Other/admin | `/(tabs)` | `app/(tabs)/_layout.tsx` |

If `segments[0]` does not match the target segment for the user's role, the auth gate redirects.

### 4 tab layouts

**Baler** (`app/(baler)/_layout.tsx`): Acasa (home), Consumabile, Harta, Starea Mea (stats), Profil
**Driver** (`app/(driver)/_layout.tsx`): Cursele Mele (trips), Livrare, Harta, Combustibil, Profil
**Loader** (`app/(loader)/_layout.tsx`): Scaneaza (scan), Incarcari (bales), Harta, Consumabile, Profil
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

### Driver (`app/(driver)/`)
| Screen | File | Purpose |
|---|---|---|
| Trips | `index.tsx` | Active trips list, links to trip detail |
| Delivery | `delivery.tsx` | `EnhancedDeliveryFlow` or `DeliveryFlow` for active trip |
| Map | `map.tsx` | `MapScreen` with route to destination |
| Fuel | `fuel.tsx` | `FuelEntryFlow` -- record fuel consumption |
| Profile | `profile.tsx` | `ProfileScreen` |

### Loader (`app/(loader)/`)
| Screen | File | Purpose |
|---|---|---|
| Scan | `index.tsx` | QR scanner to identify trucks/machines |
| Bales | `bales.tsx` | `LoadingFlow` -- record bale loads onto trips |
| Map | `map.tsx` | `MapScreen` with related machine locations |
| Consumables | `consumables.tsx` | `ConsumableFlow` |
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
| Driver delivery | `app/driver-ops/delivery-flow.tsx` | `DeliveryFlow` standalone entry |
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
2. **Push** (`src/sync/push.ts`): dequeues up to 50 entries, marks `in_flight`, POSTs to `POST /api/v1/sync/push` as `SyncPushRequest`. Each entry carries an `idempotency_key` (e.g. `bale_production_{id}`, `fuel_log_{id}`). Server returns `applied`, `skipped`, or `conflict` per mutation
3. **Pull** (`src/sync/pull.ts`): collects `getMaxServerVersion()` from each repo, POSTs to `POST /api/v1/sync/pull` with `{ tables: { trips: N, bale_loads: N, ... } }`. Server returns deltas
4. **Merge** (`src/sync/conflict.ts`): `mergeRecords()` resolves local vs server data using `server_version` as arbiter. Existing records are merged, new records are inserted via repo `upsert()`
5. **Log upload**: on zero-error sync, calls `uploadTodayMobileLogs()` (`src/sync/mobile-log-upload.ts`) to POST today's NDJSON log file to `POST /api/v1/logs/mobile`

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

## Location Tracking

### useLocationTracking (`src/hooks/useLocationTracking.ts`)

- `startTracking(machineId)`: requests foreground permission via `requestLocationPermission()`, starts `startLocationWatcher()` from `src/lib/location.ts`
- Each GPS update POSTs to `POST /api/v1/location/report` with `{ machineId, lat, lon, accuracyM, headingDeg, speedMs, recordedAt }`
- Returns `{ isTracking, error, lastReportedAt, startTracking, stopTracking }`
- All errors and successes logged via `mobileLogger`

---

## Task List

### useMyTasks (`src/hooks/useMyTasks.ts`)

- Fetches `GET /api/v1/task-assignments/daily-plan/{today}` (returns `DailyPlanResponse` with `available`, `inProgress[]`, `done`)
- Collects all assignments, filters client-side by `assignedUserId`
- Sorts by `sequenceOrder`
- Refetches every 60 seconds
- Returns `{ tasks: MyTask[], isLoading, error, refetch }`

### TaskList component (`src/components/shared/TaskList.tsx`)

Renders the filtered task list with parcel names, machine codes, status pills. Each task card links to the appropriate flow (production, loading, delivery).

---

## Feature Flows

### ProductionFlow (`src/components/features/production/ProductionFlow.tsx`)
**Steps**: info -> count -> confirm
- **info**: shows current parcel name, "Comenzi productie" button
- **count**: `NumericPad` for bale count entry (max 4 digits)
- **confirm**: `ProductionConfirmation` with summary and confirm/back
- **Save**: creates local `bale_productions` record + enqueues sync with `idempotency_key: bale_production_{id}`

### DeliveryFlow (`src/components/features/delivery/DeliveryFlow.tsx`)
**Steps**: weight -> photo -> signatures
- **weight**: `WeightInput` for gross weight entry
- **photo**: `WeightTicketPhoto` camera capture
- **signatures**: `SignatureStep` with driver/receiver/witness signature pads
- **Save**: creates local operation, updates trip status to `delivered`, enqueues sync

### EnhancedDeliveryFlow (`src/components/features/delivery/EnhancedDeliveryFlow.tsx`)
Extended delivery flow with additional steps: `DeterioratedBalesInput` (count damaged bales), `CmrConfirmation` (verify CMR data).

### LoadingFlow (`src/components/features/loading/LoadingFlow.tsx`)
**Steps**: scan -> count -> confirm
- **scan**: `QRScanner` to identify the machine
- **count**: `BaleCountInput` for number of bales loaded
- **confirm**: `LoadConfirmation` summary
- **Save**: creates local operation, updates trip to `loaded`, enqueues sync

### FuelEntryFlow (`src/components/features/fuel/FuelEntryFlow.tsx`)
**Steps**: liters -> odometer -> photo -> confirm
- **liters**: `NumericPad` (6 digits, decimal support)
- **odometer**: `NumericPad` for km reading (7 digits)
- **photo**: `PhotoCapture` for receipt (optional, can skip)
- **confirm**: summary card with all values
- **Save**: creates local `fuel_logs` record + enqueues sync

### ConsumableFlow (`src/components/features/consumables/ConsumableFlow.tsx`)
**Steps**: type -> quantity -> photo -> confirm
- **type**: `ConsumableTypeSelector` (diesel or twine)
- **quantity**: `NumericPad` (liters for diesel, kg for twine)
- **photo**: `PhotoCapture` for receipt (optional)
- **confirm**: `ConsumableConfirmation` summary
- **Save**: creates `fuel_logs` (diesel) or `consumable_logs` (twine) + enqueues sync

---

## Sync Details

### Batched logger (`src/lib/logger.ts`)

Writes NDJSON to `DocumentDirectory/strawboss-logs/{category}/{YYYY-MM-DD}.log`. Categories: `all`, `error`, `warn`, `info`, `flow`, `debug`.

**Batching**: `appendLine()` collects lines per file in a `pendingLines` Map, `flushPending()` runs after 2-second debounce to batch-write all pending lines.

**7-day cleanup**: `cleanupOldMobileLogFiles()` lists files in each category dir, deletes `.log` files with dates older than 7 days. Runs on app mount and every `AppState` resume.

### Idempotency keys
Each sync queue entry carries a unique `idempotency_key`:
- `bale_production_{uuid}` -- baler production records
- `fuel_log_{id}` -- fuel entries
- `consumable_log_{id}` -- consumable entries
- `deliver_{tripId}` -- delivery completion
- `load_{tripId}` -- loading completion

### In-flight reset (`SyncQueueRepo.resetInFlight()`)
On sync start, all entries stuck as `in_flight` (from a crashed previous sync) are reset to `pending`. This prevents data loss on interrupted syncs.

### SQL MAX versions
Each repo has `getMaxServerVersion()`: `SELECT MAX(server_version) FROM {table}`. This value is sent during pull to get only newer records. The server returns records with `sync_version > requested` up to LIMIT 1000.

---

## Build System

### App config (`app.json`)
- Package: `com.strawboss.mobile`
- Plugins: expo-router, expo-camera, expo-image-picker, expo-sqlite, expo-location
- Android permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`
- iOS: location usage descriptions for when-in-use, always, and both

### EAS Build
Cloud builds via Expo Application Services. Profile configured in `eas.json`.

### Local Android build
`./strawboss.sh mobile-build-local` (optional `ANDROID_HOME` env var for SDK path). Produces APK via Gradle.

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
- `WhatsAppLink` -- deep link to WhatsApp chat
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

---

## Related Docs

- [Backend](backend.md) -- sync/push, sync/pull, location/report, notifications endpoints
- [Admin Web](admin-web.md) -- complementary admin dashboard
