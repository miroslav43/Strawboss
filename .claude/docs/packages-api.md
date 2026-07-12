---
type: doc
title: "@strawboss/api"
created: 2026-04-16
updated: 2026-07-12
tags: [doc, package, api, tanstack-query, supabase]
status: mature
related:
  - "[[architecture]]"
  - "[[backend]]"
  - "[[admin-web]]"
  - "[[mobile]]"
  - "[[packages-types]]"
  - "[[packages-validation]]"
---

# @strawboss/api

Shared data layer consumed by both `admin-web` and `mobile`. Provides the `ApiClient` class, Supabase client factory, TanStack Query key factory, and 25 React Query hook files (index counts as one file; includes `useLocationKmByDay` added in Plan C, `use-fleet.ts` added in fleet feature).

**Source:** `packages/api/src/`

## ApiClient (`client/api-client.ts`)

Typed fetch wrapper for the NestJS backend (`/api/v1/*`).

```ts
interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  onApiError?: (info: { method, path, status, message, data? }) => void;
}
```

### Methods

| Method | Signature |
|---|---|
| `get<T>(path)` | GET request |
| `post<T>(path, body?)` | POST request |
| `put<T>(path, body?)` | PUT request |
| `patch<T>(path, body?)` | PATCH request |
| `delete<T>(path)` | DELETE request |
| `upload<T>(path, formData)` | POST multipart form data |

### Behavior

- Injects `Authorization: Bearer <token>` from `getToken()`.
- On 401, retries once after re-calling `getToken()` (token refresh).
- On non-OK responses, throws `ApiError(status, message, data)` and calls `onApiError` hook.
- 204 responses return `undefined`.

## Supabase Client Factory (`client/supabase.ts`)

```ts
interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

interface CreateClientOptions {
  storage?: AuthStorage;           // omit on web (defaults to localStorage)
  detectSessionInUrl?: boolean;    // set false on React Native (no URL to parse)
}

function createClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: CreateClientOptions,
): SupabaseClient
```

Wraps `@supabase/supabase-js` with `persistSession: true` and `autoRefreshToken: true`. The optional third argument is backward-compatible: `admin-web` calls `createClient(url, key)` with no options and is unchanged. The [[mobile]] app passes a `SecureStore`-backed `AuthStorage` adapter so the session survives cold starts on React Native (which has no `localStorage`). Both `AuthStorage` and `CreateClientOptions` are re-exported from `client/index.ts`.

## Query Keys Factory (`queries/query-keys.ts`)

Centralized TanStack Query key definitions. Every hook references these for cache invalidation.

| Domain | Keys |
|---|---|
| `trips` | `.all`, `.list(filters?)`, `.detail(id)` |
| `parcels` | `.all`, `.list(filters?)`, `.detail(id)` |
| `machines` | `.all`, `.list(filters?)`, `.detail(id)` |
| `taskAssignments` | `.all`, `.list(filters?)`, `.byDate(date)`, `.dailyPlan(date)`, `.byMachineType(date, type)` |
| `parcelDailyStatus` | `.all`, `.byDate(date)` |
| `baleLoads` | `.all`, `.byTrip(tripId)` |
| `fuelLogs` | `.all`, `.byMachine(machineId)` |
| `documents` | `.all`, `.byTrip(tripId)`, `.detail(id)` |
| `alerts` | `.all`, `.list(filters?)`, `.unacknowledged()` |
| `dashboard` | `.overview()`, `.production(filters?)`, `.costs(filters?)`, `.antiFraud()`, `.trending()` |
| `location` | `.machines()`, `.route(machineId, from, to)`, `.related()`, `.kmByDay(machineId, from, to)` |
| `auth` | `.session()` |
| `sync` | `.status()` |
| `baleProductions` | `.all`, `.list(filters?)`, `.byOperator(operatorId)`, `.stats(filters?)` |
| `farms` | `.all`, `.list(filters?)`, `.detail(id)` |
| `deliveryDestinations` | `.all`, `.list(filters?)`, `.detail(id)` |
| `tripRequests` | `.all`, `.list(filters?)`, `.detail(id)`, `.avize(id)`, `.cmrScans(id)` |
| `orgRequestSettings` | `.all` |
| `devices` | `.all`, `.list(filters?)`, `.detail(id)`, `.otaStatus(id)`, `.logs(id, filters?)` |
| `releases` | `.all` |
| `deployments` | `.all` |
| `settings` | `.tailscale()` → `['super-admin', 'settings', 'tailscale']` |

## React Query Hooks

All hooks take `client: ApiClient` as their first argument (plus entity-specific params).
Mutations auto-invalidate related query keys on success.

### Trips (`hooks/use-trips.ts`)

| Hook | Type | Endpoint |
|---|---|---|
| `useTrips(client, filters?)` | Query | `GET /api/v1/trips` |
| `useTrip(client, tripId)` | Query | `GET /api/v1/trips/:id` |
| `useCreateTrip(client)` | Mutation | `POST /api/v1/trips` |
| `useStartLoading(client)` | Mutation | `POST /api/v1/trips/:id/start-loading` |
| `useCompleteLoading(client)` | Mutation | `POST /api/v1/trips/:id/complete-loading` |
| `useDepart(client)` | Mutation | `POST /api/v1/trips/:id/depart` |
| `useArrive(client)` | Mutation | `POST /api/v1/trips/:id/arrive` |
| `useStartDelivery(client)` | Mutation | `POST /api/v1/trips/:id/start-delivery` |
| `useConfirmDelivery(client)` | Mutation | `POST /api/v1/trips/:id/confirm-delivery` |
| `useCompleteTrip(client)` | Mutation | `POST /api/v1/trips/:id/complete` |
| `useCancelTrip(client)` | Mutation | `POST /api/v1/trips/:id/cancel` |

### Parcels (`hooks/use-parcels.ts`)

| Hook | Type | Endpoint |
|---|---|---|
| `useParcels(client, filters?)` | Query | `GET /api/v1/parcels` |
| `useParcel(client, id)` | Query | `GET /api/v1/parcels/:id` |
| `useCreateParcel(client)` | Mutation | `POST /api/v1/parcels` |
| `useUpdateParcel(client)` | Mutation | `PATCH /api/v1/parcels/:id` |
| `useUpdateParcelBoundary(client)` | Mutation | `PATCH /api/v1/parcels/:id` (boundary only) |
| `useDeleteParcel(client)` | Mutation | `DELETE /api/v1/parcels/:id` (soft-delete) |

### Machines (`hooks/use-machines.ts`)

| Hook | Type | Endpoint |
|---|---|---|
| `useMachines(client, filters?)` | Query | `GET /api/v1/machines` |
| `useMachine(client, id)` | Query | `GET /api/v1/machines/:id` |
| `useCreateMachine(client)` | Mutation | `POST /api/v1/machines` |
| `useUpdateMachine(client)` | Mutation | `PATCH /api/v1/machines/:id` |

### Task Assignments (`hooks/use-task-assignments.ts`)

| Hook | Type | Endpoint |
|---|---|---|
| `useTaskAssignments(client, date)` | Query | `GET /api/v1/task-assignments?date=` |
| `useDailyPlan(client, date)` | Query | `GET /api/v1/task-assignments/daily-plan/:date` |
| `useCreateTaskAssignment(client)` | Mutation | `POST /api/v1/task-assignments` |
| `useBulkCreateTaskAssignments(client)` | Mutation | `POST /api/v1/task-assignments/bulk` |
| `useAssignMachineToParcel(client)` | Mutation | `POST /api/v1/task-assignments` |
| `useUpdateAssignmentStatus(client)` | Mutation | `PATCH /api/v1/task-assignments/:id/status` |
| `useAutoCompleteAssignments(client)` | Mutation | `POST /api/v1/task-assignments/auto-complete` |
| `useTasksByMachineType(client, date, type)` | Query | `GET /api/v1/task-assignments/by-machine-type/:date/:type` |
| `useUpdateTaskAssignment(client)` | Mutation | `PATCH /api/v1/task-assignments/:id` |
| `useDeleteTaskAssignment(client)` | Mutation | `DELETE /api/v1/task-assignments/:id` |

### Other Entity Hooks

| Hook | Endpoint |
|---|---|
| `useBaleLoads(client, tripId)` | `GET /api/v1/trips/:id/bale-loads` |
| `useCreateBaleLoad(client)` | `POST /api/v1/trips/:id/bale-loads` |
| `useFuelLogs(client, machineId?)` | `GET /api/v1/fuel-logs` |
| `useCreateFuelLog(client)` | `POST /api/v1/fuel-logs` |
| `useDocuments(client, tripId?)` | `GET /api/v1/documents` |
| `useDocument(client, id)` | `GET /api/v1/documents/:id` |
| `useGenerateCmr(client)` | `POST /api/v1/trips/:id/generate-cmr` |
| `useAlerts(client, filters?)` | `GET /api/v1/alerts` |
| `useUnacknowledgedAlerts(client)` | `GET /api/v1/alerts?acknowledged=false` |
| `useAcknowledgeAlert(client)` | `POST /api/v1/alerts/:id/acknowledge` |
| `useParcelDailyStatuses(client, date)` | `GET /api/v1/parcel-daily-status?date=` |
| `useUpsertParcelDailyStatus(client)` | `PUT /api/v1/parcel-daily-status` |
| `useDeleteParcelDailyStatusForDate(client)` | `DELETE /api/v1/parcel-daily-status?parcelId=&date=` |
| `useBaleProductions(client, filters?)` | `GET /api/v1/bale-productions` |
| `useBaleProductionStats(client, filters?)` | `GET /api/v1/bale-productions/stats` |
| `useCreateBaleProduction(client)` | `POST /api/v1/bale-productions` |
| `useDeliveryDestinations(client)` | `GET /api/v1/delivery-destinations` |
| `useDeliveryDestination(client, id)` | `GET /api/v1/delivery-destinations/:id` |
| `useCreateDeliveryDestination(client)` | `POST /api/v1/delivery-destinations` |
| `useUpdateDeliveryDestination(client)` | `PATCH /api/v1/delivery-destinations/:id` |
| `useDeleteDeliveryDestination(client)` | `DELETE /api/v1/delivery-destinations/:id` |
| `useFarms(client)` | `GET /api/v1/farms` (staleTime: 30s) |
| `useFarm(client, id)` | `GET /api/v1/farms/:id` |
| `useCreateFarm(client)` | `POST /api/v1/farms` |
| `useUpdateFarm(client)` | `PATCH /api/v1/farms/:id` |
| `useDeleteFarm(client)` | `DELETE /api/v1/farms/:id` |
| `useAssignParcelToFarm(client)` | `PATCH /api/v1/parcels/:id` (farmId only) |

### Trip Requests (`hooks/use-trip-requests.ts`)

External pickup requests submitted through the public per-org portal (`/<slug>/request`). See [[packages-types]] for the `TripRequest` entity.

| Hook | Type | Endpoint | Notes |
|---|---|---|---|
| `useTripRequests(client, filters?)` | Query | `GET /api/v1/trip-requests` | filters: `status`, `dateFrom`, `dateTo` |
| `useTripRequest(client, id)` | Query | `GET /api/v1/trip-requests/:id` | |
| `useConfirmTripRequest(client)` | Mutation | `POST /api/v1/trip-requests/:id/confirm` | Spins up a one-time auxiliary truck (machine); invalidates `tripRequests.all` + `machines.all` + `taskAssignments.all` |
| `useCancelTripRequest(client)` | Mutation | `POST /api/v1/trip-requests/:id/cancel` | |
| `useRequestAvize(client, requestId)` | Query | `GET /api/v1/trip-requests/:id/aviz` | Returns 0 or 1 `Document` (single-aviz model) |
| `useUploadAviz(client)` | Mutation | `POST /api/v1/trip-requests/:id/aviz` (multipart) | Invalidates that request's avize + `tripRequests.all` |
| `useRequestCmrScans(client, requestId)` | Query | `GET /api/v1/cmr-scans/trip-request/:id` | Returns 0 or 1 `Document` of type `cmr_scan` — the scanned paper CMR for an auxiliary load |
| `useUploadCmrScan(client)` | Mutation | `POST /api/v1/cmr-scans/trip-request/:id` (multipart) | Admin override upload — the loader normally posts the scan from the phone against the trip instead. Invalidates `tripRequests.cmrScans(id)` **and** `tripRequests.all`, since `hasCmrScan` is computed server-side on the list row, not the document |
| `useOrgRequestSettings(client)` | Query | `GET /api/v1/organizations/me/request-settings` | Admin: caller's own org portal code + allowed crop list |
| `useUpdateOrgRequestSettings(client)` | Mutation | `PATCH /api/v1/organizations/me/request-settings` | Sets `orgRequestSettings.all` query data on success |

### Auth, Profile, Location, Sync

| Hook | Endpoint | Notes |
|---|---|---|
| `useSession(supabaseClient)` | Supabase `auth.getSession()` | Takes SupabaseClient, not ApiClient |
| `useLogin(supabaseClient)` | Supabase `signInWithPassword` | |
| `useLogout(supabaseClient)` | Supabase `signOut` | |
| `useProfile(client)` | `GET /api/v1/profile` | |
| `useUpdateProfileLocale(client)` | `PATCH /api/v1/profile` | Optimistic: sets query data on success |
| `useUpdateProfile(client)` | `PATCH /api/v1/profile` | |
| `useChangePassword(client)` | `POST /api/v1/profile/change-password` | |
| `useAdminUsers(client)` | `GET /api/v1/admin/users` | Admin only |
| `useCreateUser(client)` | `POST /api/v1/admin/users` | |
| `useUpdateUser(client)` | `PATCH /api/v1/admin/users/:id` | |
| `useDeactivateUser(client)` | `DELETE /api/v1/admin/users/:id` | Soft-delete |
| `useMachineLocations(client)` | `GET /api/v1/location/machines` | Polls every 30s |
| `useRouteHistory(client, machineId, from, to)` | `GET /api/v1/location/machines/:id/route` | |
| `useLocationKmByDay(client, machineId, from, to)` | `GET /api/v1/location/machines/:id/km-by-day` | Returns `KmByDayResponse` |
| `useSyncStatus(client)` | `GET /api/v1/sync/status` | |
| `useSyncPush(client)` | `POST /api/v1/sync/push` | |
| `useSyncPull(client)` | `POST /api/v1/sync/pull` | |
| `useDashboardOverview(client)` | `GET /api/v1/dashboard/overview` | |
| `useDashboardTrending(client)` | `GET /api/v1/dashboard/trending` | Returns `TrendingDay[]` |
| `useProductionReport(client, filters?)` | `GET /api/v1/dashboard/production` | |
| `useCostReport(client, filters?)` | `GET /api/v1/dashboard/costs` | |
| `useAntiFraudReport(client)` | `GET /api/v1/dashboard/anti-fraud` | |

### Fleet (`hooks/use-fleet.ts`)

Super-admin routes under `/api/v1/super-admin/`. All read hooks take `client: ApiClient`; mutations also accept `useQueryClient` internally for cache invalidation.

#### Devices

| Hook | Type | Endpoint | Notes |
|---|---|---|---|
| `useDevices(client)` | Query | `GET /api/v1/super-admin/devices` | Returns `FleetDeviceListItem[]`; refetches every 20 s |
| `useDevice(client, id)` | Query | `GET /api/v1/super-admin/devices/:id` | Returns `Device`; disabled when id is empty |
| `useUpdateDevice(client)` | Mutation | `PATCH /api/v1/super-admin/devices/:id` | Accepts `UpdateDeviceInput`; sets detail cache on success |
| `useDeleteDevice(client)` | Mutation | `DELETE /api/v1/super-admin/devices/:id` | Soft-delete |
| `useDeviceOtaStatus(client, id)` | Query | `GET /api/v1/super-admin/devices/:id/ota-status` | Returns `DeviceOtaStatusWithVersion[]`; refetches every 8 s |
| `useDeviceLogs(client, id, filters?)` | Query | `GET /api/v1/super-admin/devices/:id/logs` | `filters`: `{ level?, date? }`; returns `DeviceLogResponse` |

Local interfaces in `use-fleet.ts`: `DeviceLogFilters`, `DeviceLogEntry`, `DeviceLogResponse`, `DeviceOtaStatusWithVersion` (extends `DeviceOtaStatus` with `version: string` and `versionCode: number`).

#### Releases

| Hook | Type | Endpoint | Notes |
|---|---|---|---|
| `useReleases(client)` | Query | `GET /api/v1/super-admin/releases` | Returns `AppRelease[]` |
| `useUploadRelease(client)` | Mutation | `POST /api/v1/super-admin/releases` | Accepts `FormData` (multipart APK upload) |
| `useUpdateRelease(client)` | Mutation | `PATCH /api/v1/super-admin/releases/:id` | Accepts `UpdateReleaseInput` |

#### Deployments

| Hook | Type | Endpoint | Notes |
|---|---|---|---|
| `useDeployments(client)` | Query | `GET /api/v1/super-admin/deployments` | Returns `OtaDeployment[]` |
| `useCreateDeployment(client)` | Mutation | `POST /api/v1/super-admin/deployments` | Accepts `CreateDeploymentInput` |
| `useCancelDeployment(client)` | Mutation | `POST /api/v1/super-admin/deployments/:id/cancel` | |

#### Tailscale Remote Access

| Hook | Type | Endpoint | Notes |
|---|---|---|---|
| `useSetDeviceTailscale(client)` | Mutation | `PATCH /api/v1/super-admin/devices/:id/tailscale` | Accepts `{ id, desired: boolean }`; sets `tailscaleDesired` on the device; invalidates `devices.all` + sets detail cache |
| `useTailscaleSettings(client)` | Query | `GET /api/v1/super-admin/settings/tailscale` | Returns `AppSettings` (no raw secrets); refetches every 60 s |
| `useUpdateTailscaleSettings(client)` | Mutation | `PUT /api/v1/super-admin/settings/tailscale` | Accepts `UpdateTailscaleSettingsInput` (`authKey`, `tailnet`, `oauthClientId`, `oauthClientSecret`, `tag`); invalidates `settings.tailscale` |
| `useUploadTailscaleApk(client)` | Mutation | `POST /api/v1/super-admin/settings/tailscale-apk` | Accepts `FormData` (field `apk`); sets the hosted Tailscale APK for zero-touch auto-install; invalidates `settings.tailscale` |

`useUpdateTailscaleSettings` uses `client.put` (full replace semantics). `useUploadTailscaleApk` uses `client.upload` (multipart). Both return `AppSettings` on success.

See [[packages-types]] for entity shapes and [[packages-validation]] for input schemas.
