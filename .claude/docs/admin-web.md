---
type: doc
title: "Admin Web (apps/admin-web)"
created: 2026-04-16
updated: 2026-06-28
tags: [doc, frontend, layer, nextjs]
status: mature
related:
  - "[[architecture]]"
  - "[[packages-api]]"
  - "[[packages-ui-tokens]]"
  - "[[backend]]"
---

<!-- updated 2026-06-28: /healthz Swarm probe, preloadEntriesOnStart disabled, HOSTNAME=0.0.0.0 deploy note -->
<!-- updated 2026-06-22: Fleet — Tailscale controls, nickname-first display, APK filename column -->

# Admin Web (`apps/admin-web`)

Next.js 15 App Router + Tailwind CSS v4. Consumes backend API via `@strawboss/api` React Query hooks. Real-time updates via Supabase Realtime channels.

---

## Pages Inventory

All routes live under `src/app/`. Two route groups: `(auth)` for login, `(dashboard)` for authenticated pages.

| Route | File | Status | Description |
|---|---|---|---|
| `/login` | `(auth)/login/page.tsx` | 100% | Supabase email/password login form |
| `/` (dashboard) | `(dashboard)/page.tsx` | 100% | KPI cards, trending chart, top operators, recent trips |
| `/trips` | `(dashboard)/trips/page.tsx` | 100% | Trip list with status/date filters, links to detail |
| `/trips/[tripId]` | `(dashboard)/trips/[tripId]/page.tsx` | 100% | Trip detail with TripTimeline, TripDetail component |
| `/map` | `(dashboard)/map/page.tsx` | 100% | Full-screen LeafletMap with sidebar panels |
| `/tasks` | `(dashboard)/tasks/page.tsx` | 100% | Daily plan kanban board (DailyPlanBoard) |
| `/tasks/balers` | `(dashboard)/tasks/balers/page.tsx` | 100% | MachinePlanBoard filtered to balers |
| `/tasks/loaders` | `(dashboard)/tasks/loaders/page.tsx` | 100% | MachinePlanBoard filtered to loaders |
| `/tasks/trucks` | `(dashboard)/tasks/trucks/page.tsx` | 100% | TruckPlanBoard for truck assignments with deposit+loader pickers |
| `/parcels` | `(dashboard)/parcels/page.tsx` | 100% | Parcel list with create/edit forms |
| `/machines` | `(dashboard)/machines/page.tsx` | 100% | Machine registry with type filters |
| `/farms` | `(dashboard)/farms/page.tsx` | 100% | Farm list with CRUD |
| `/deposits` | `(dashboard)/deposits/page.tsx` | 100% | Delivery destination management |
| `/operations` | `(dashboard)/operations/page.tsx` | 100% | OperationStatusGrid -- operation overview |
| `/alerts` | `(dashboard)/alerts/page.tsx` | 100% | AlertList with severity/category filters, acknowledge action |
| `/reports` | `(dashboard)/reports/page.tsx` | 100% | Tabbed: Production, Costs, Operators with chart components |
| `/documents` | `(dashboard)/documents/page.tsx` | 100% | Document list with type filters |
| `/documents/[documentId]` | `(dashboard)/documents/[documentId]/page.tsx` | 100% | DocumentViewer for PDF/image preview |
| `/accounts` | `(dashboard)/accounts/page.tsx` | 100% | Admin user management (list, create, edit, deactivate) |
| `/settings` | `(dashboard)/settings/page.tsx` | 100% | Profile editing, password change, locale toggle, notification prefs |
| `/deposits` | `(dashboard)/deposits/page.tsx` | 100% | Delivery destination management (Plan C — previously under `/delivery-destinations`) |
| `/command-center` | `(dashboard)/command-center/page.tsx` | 100% | Multi-trip board with `UserPresenceDot` for live operator presence (Plan C) |

### Infrastructure routes

| Route | File | Description |
|---|---|---|
| `GET /healthz` | `src/app/healthz/route.ts` | Swarm liveness probe. `dynamic = 'force-static'`; returns `{ status: 'ok' }` with HTTP 200. Auth-free and dependency-free — answers from cache without invoking the React renderer. Used by `docker-stack.yml` `healthcheck`. |

### Super-admin area (`src/app/super-admin/(dashboard)/`)

A separate route group with its own layout. Accessible only to users whose JWT `app_metadata.role` equals `super_admin`; any other role is redirected to `/login`. The layout (`layout.tsx`) renders a minimal dark header with two nav links — Organizations and Devices — but no Sidebar or RealtimeProvider.

| Route | File | Description |
|---|---|---|
| `/super-admin/organizations` | `organizations/page.tsx` | Organization list with create/edit |
| `/super-admin/organizations/new` | `organizations/new/page.tsx` | New organization form |
| `/super-admin/organizations/[id]/users` | `organizations/[id]/users/page.tsx` | Users within an organization |
| `/super-admin/devices` | `devices/page.tsx` | Fleet device list (see below) |
| `/super-admin/devices/releases` | `devices/releases/page.tsx` | APK release management (see below) |
| `/super-admin/devices/[id]` | `devices/[id]/page.tsx` | Device detail with OTA timeline + log viewer (see below) |

---

## Fleet Management (OTA) — Super-admin

All pages live under `src/app/super-admin/(dashboard)/devices/`. They are **super_admin-only** — the layout gate enforces this. Because the `super_admin` role fails the standard devices RLS path, these pages use **TanStack Query polling** instead of Supabase Realtime.

### Fleet device list (`devices/page.tsx`)

Renders all registered mobile devices grouped by organization. The "Unassigned" group (devices with `organizationId = null`) appears first; other groups are keyed by `organizationId` with the `organizationName` as the heading label.

**Nickname-first display (`DeviceNickname` component):** `devices.name` is shown as the primary, bold identifier everywhere in this page — list rows, the device multi-select in the push modal, the edit modal header, and the delete confirmation dialog. The organization name is shown below as secondary text; the first 8 characters of `deviceUuid` (monospace) are shown below that. When no nickname is set, an italicized placeholder is used.

Per-device row columns: app-online dot, nickname/org/UUID, manufacturer + model, `appVersion (versionCode)`, OTA-state badge, Tailscale cell, last-seen timestamp, edit + delete actions.

**App-online dot (`OnlineDot`):** green when `lastSeenAt` within 90 seconds, grey otherwise. This threshold is stricter than the 15-minute threshold used on the main `/map` page.

**OTA state badge (`OtaStateBadge`):** color-coded pill per `OtaState` enum value:
- `pending`, `notified` → neutral
- `downloading`, `downloaded` → blue
- `awaiting_idle`, `installing` → amber
- `installed` → green
- `failed` → red

**Tailscale column (`TailscaleCell`):** each row shows two controls side by side:

1. `TailscaleDot` — a distinct colored dot (separate from the app-online dot):
   - Grey: Tailscale not desired (disabled)
   - Teal/green: desired AND online
   - Amber: desired but not yet online (pending registration)

2. `TailscaleToggle` — a teal pill toggle switch. Calls `useSetDeviceTailscale(apiClient)` → `PATCH /api/v1/super-admin/devices/:id/tailscale` with `{ desired: boolean }`. Disabled while the mutation is in-flight. Click is stopPropagated so it does not navigate to the device detail page.

**Modals on this page:**
- `EditDeviceModal` — rename device (`devices.name`) and assign/reassign to an organization (`PATCH /api/v1/super-admin/devices/:id`). Uses `useUpdateDevice`. Nickname is shown prominently in the modal header.
- `DeleteDeviceDialog` — confirm-delete. Shows nickname (or "noName" placeholder) and full `deviceUuid`. Uses `useDeleteDevice`.
- `PushUpdateModal` — create a new `OtaDeployment`. Device multi-select lists devices nickname-first. See Push/Schedule Modal below.
- `TailscaleSettingsModal` — global Tailscale configuration. See Tailscale Settings Modal below.

Header actions (left-to-right): "Tailscale Settings" button (teal-bordered, opens `TailscaleSettingsModal`), link to `/super-admin/devices/releases` (PackageOpen icon), and the "Push Update" button that opens `PushUpdateModal`.

Data hooks: `useDevices(apiClient)` — `refetchInterval: 20_000` ms. Also fetches `useReleases` for the push modal and loads the organization list once via a raw `apiClient.get('/api/v1/organizations')` call (non-critical, failure is swallowed).

### Tailscale Settings Modal (`TailscaleSettingsModal`)

A full-screen overlay opened from the device list header. Reads current settings with `useTailscaleSettings(apiClient)` and saves with `useUpdateTailscaleSettings(apiClient)`. Contains two independent sections:

**Settings form (submitted together):**

| Field | Type | Notes |
|---|---|---|
| Shared auth key | `<input type="password">` with eye toggle | Shown masked. Status label indicates "set" / "unset". A "Clear" checkbox sends `authKey: ''` to revoke. An amber warning box reminds that shared auth keys expire. |
| Tailnet | `<input type="text">` | Seeded from `settings.tailscaleTailnet`. |
| OAuth client ID | `<input type="text">` | For per-device ephemeral key minting. |
| OAuth client secret | `<input type="password">` with eye toggle | Shown masked. A "Clear" checkbox sends both ID and secret as `''`. A teal badge shows configured/not-configured status. |
| Tag | `<input type="text">` | ACL tag applied to ephemeral keys (e.g. `tag:strawboss-device`). Seeded from `settings.tailscaleTag`. |

Submit → `PATCH /api/v1/super-admin/tailscale-settings`. Closes modal on success.

**Tailscale APK upload (separate action below the form):**

A file picker (`accept=".apk"`) and an Upload button. Calls `useUploadTailscaleApk(apiClient)` — `POST /api/v1/super-admin/tailscale-apk` as `multipart/form-data`. A green/neutral badge indicates whether the APK is currently stored. Used to distribute the Tailscale Android client to managed devices via OTA without relying on Google Play.

Secrets are never displayed in plain text; the raw key is never echoed back. The UI only shows set/unset status.

### Push / Schedule modal (`PushUpdateModal`)

Inline component in `devices/page.tsx`. Fields:

| Field | Type | Notes |
|---|---|---|
| Release | `<select>` | Filtered to `ReleaseStatus.published` only. Mandatory. |
| Target | radio `OtaTargetKind` | `all` / `org` / `device_set` |
| Organization | `<select>` (conditional) | Shown when `targetKind === OtaTargetKind.org` |
| Devices | scrollable checkbox list (conditional) | Shown when `targetKind === OtaTargetKind.device_set` |
| Schedule | `<input type="datetime-local">` | Optional; converted to ISO string. Empty = immediate. |
| Force Now | checkbox | Bypasses the device idle gate (installs even mid-trip). Styled with amber warning colors. |

Submit calls `useCreateDeployment(apiClient)` → `POST /api/v1/super-admin/deployments`.

### Releases page (`devices/releases/page.tsx`)

**Upload form (`UploadReleaseForm`):** drag-click APK file picker (`accept=".apk"`), semver `version`, integer `versionCode`, optional `changelog` textarea, `mandatory` checkbox. Submits as `multipart/form-data` via `useUploadRelease(apiClient)` → `POST /api/v1/super-admin/releases`. Clears form on success and shows a 3-second green toast.

**Release list:** table showing version / `versionCode`, `ReleaseStatusBadge`, mandatory flag, file size (converted to MB), changelog snippet (truncated), upload date, and the **APK filename** (`r.apkKey.split('/').pop()` — the storage path's basename, rendered as truncated monospace below the version number, max-width 14 rem). The filename is also shown in the cell title attribute for the full name on hover.

`ReleaseStatusBadge` colors: `draft` = neutral, `published` = green, `archived` = neutral-grey.

Row actions (`ReleaseActions`): `draft` → Publish button (`useUpdateRelease` → `PATCH …/releases/:id`); `published` → Archive button. Only one action visible at a time.

Data hook: `useReleases(apiClient)` — no polling interval (reads are cheap, changes are infrequent).

### Device detail (`devices/[id]/page.tsx`)

**Breadcrumb:** shows the device nickname (`devices.name`) prominently as the terminal segment; falls back to an italicized "noName" placeholder.

**Identity card:** nickname displayed as the primary `<h1>` (bold, large). `deviceUuid` (monospace) shown as secondary below the title. The card header shows two status rows side by side:
- App-online dot + text ("Online" / "Offline"), same 90 s threshold.
- Tailscale status dot + text ("Tailscale online" / "pending" / "offline") with the tailnet IP in parentheses when online.

`appVersion (versionCode)` shown top-right. Info grid: manufacturer/model, OS version, Android ID (monospace), `isDeviceOwner` (green tick if true), last-seen, last-checkin.

Three tabs: **OTA**, **Logs**, and **Tailscale**.

**OTA tab (`OtaTimeline`):** list of `DeviceOtaStatusWithVersion` entries from `useDeviceOtaStatus(apiClient, id)` — `refetchInterval: 8_000` ms. Each card shows: state badge (with icon — `Clock`, `Download`, `RefreshCw spin`, `CheckCircle2`, `XCircle`), `version (versionCode)`, deployment UUID, retry-attempt badge (shown when `attempt > 1`), inline error block, and per-row timestamps (notified, downloaded, installed, updated).

**Logs tab (`LogViewer`):** calls `useDeviceLogs(apiClient, id, { level?, date? })` — no polling (manual refresh). Filters: level pills (`all / error / warn / info / flow / debug`) and a date picker (`<input type="date">`). Output rendered in a dark (`bg-neutral-950`) monospace scrollable panel (max height 480 px). Each line: timestamp (HH:mm:ss), colored level tag, optional context bracket, message. Level colors: `error`=red, `warn`=amber, `info`=blue, `flow`=purple, `debug`=neutral.

**Tailscale tab (`TailscalePanel`):** displays and controls this device's Tailscale membership.

- **Status + toggle row:** three-state dot (teal = desired+online, amber = desired but pending, grey = off) with a descriptive label. ON/OFF toggle calls `useSetDeviceTailscale(apiClient)` → `PATCH /api/v1/super-admin/devices/:id/tailscale`.
- **Tailnet IP card:** shown when `tailscaleIp` is present. Includes a `CopyButton` that copies the IP to the clipboard.
- **Tunnel command card:** shows `./strawboss.sh fleet:tunnel <hostname>` with a `CopyButton`. The hostname used is `device.tailscaleHostname` — the **backend-sanitized** hostname (`[a-z0-9-]` only), NOT the free-form `devices.name`. This is injection-safe: no shell metacharacters can appear in the command regardless of what the nickname contains. When no sanitized hostname is available, an amber warning is shown instead.
- **"Why off" card:** shown when `tailscaleLastError` or `tailscaleLastSeen` is present. Displays the last error in a red panel and the last-seen timestamp as a best-effort explanation for why the device is not online.

Data hooks used on this page: `useDevice`, `useDeviceOtaStatus`, `useDeviceLogs`, `useSetDeviceTailscale` (all from `@strawboss/api`).

### i18n

All user-visible strings use the `superAdmin.devices.*` namespace in `messages/en.json` and `messages/ro.json`. Key sub-namespaces: `otaState.*` (one key per `OtaState` value), `releaseStatus.*` (one key per `ReleaseStatus`), `pushModal.*`, `editModal.*`, `deleteDialog.*`, `releases.*`, `detail.*`, `tailscale.*`.

`tailscale.*` keys include: `online`, `offline`, `pending`, `enable`, `disable`, `settingsTitle`, `settingsSubtitle`, `settingsButton`, `authKeyLabel`, `authKeySet`, `authKeyUnset`, `authKeyPlaceholder`, `authKeyClear`, `authKeyClearHint`, `keyWarning`, `tailnetLabel`, `tailnetPlaceholder`, `oauthSectionTitle`, `oauthConfigured`, `oauthNotConfigured`, `oauthHint`, `oauthClientIdLabel`, `oauthClientIdPlaceholder`, `oauthClientSecretLabel`, `oauthClientSecretPlaceholder`, `oauthClientIdClear`, `oauthClientIdClearHint`, `tagLabel`, `tagPlaceholder`, `tagHint`, `updatedAt`, `saving`, `save`, `apkSectionTitle`, `apkSet`, `apkUnset`, `apkHint`, `apkFileLabel`, `apkUploading`, `apkUploadButton`, `apkUploadError`, `ip`, `tunnelCmd`, `tunnelCopy`, `tunnelNoName`, `lastError`, `lastSeen`.

### Types and hooks reference

See [[packages-types]] for `Device`, `FleetDeviceListItem`, `AppRelease`, `OtaDeployment`, `DeviceOtaStatus`, `OtaState`, `OtaTargetKind`, `ReleaseStatus`, `OtaDeploymentStatus`, `DeviceCheckinRequest`, `DeviceCheckinResponse`, `PendingDeployment`.

Fleet hooks live in `packages/api/src/hooks/use-fleet.ts` and are re-exported from `@strawboss/api`:

| Hook | Polling | Endpoint |
|---|---|---|
| `useDevices` | 20 s | `GET /api/v1/super-admin/devices` |
| `useDevice` | none | `GET /api/v1/super-admin/devices/:id` |
| `useUpdateDevice` | mutation | `PATCH /api/v1/super-admin/devices/:id` |
| `useDeleteDevice` | mutation | `DELETE /api/v1/super-admin/devices/:id` |
| `useSetDeviceTailscale` | mutation | `PATCH /api/v1/super-admin/devices/:id/tailscale` |
| `useDeviceOtaStatus` | 8 s | `GET /api/v1/super-admin/devices/:id/ota-status` |
| `useDeviceLogs` | none | `GET /api/v1/super-admin/devices/:id/logs` |
| `useReleases` | none | `GET /api/v1/super-admin/releases` |
| `useUploadRelease` | mutation | `POST /api/v1/super-admin/releases` (multipart) |
| `useUpdateRelease` | mutation | `PATCH /api/v1/super-admin/releases/:id` |
| `useDeployments` | none | `GET /api/v1/super-admin/deployments` |
| `useCreateDeployment` | mutation | `POST /api/v1/super-admin/deployments` |
| `useCancelDeployment` | mutation | `POST /api/v1/super-admin/deployments/:id/cancel` |
| `useTailscaleSettings` | none | `GET /api/v1/super-admin/tailscale-settings` |
| `useUpdateTailscaleSettings` | mutation | `PATCH /api/v1/super-admin/tailscale-settings` |
| `useUploadTailscaleApk` | mutation | `POST /api/v1/super-admin/tailscale-apk` (multipart) |

---

## Auth Flow

### Client-side gate (`src/app/(dashboard)/layout.tsx`)

`DashboardLayout` checks session on mount via `supabase.auth.getSession()`. If no session, redirects to `/login`. Subscribes to `supabase.auth.onAuthStateChange()` for live session invalidation. The layout renders nothing until `ready` is true (session confirmed).

### Login page (`src/app/(auth)/login/page.tsx`)

Calls `supabase.auth.signInWithPassword()`. On success, the auth state listener in the dashboard layout picks up the new session and renders.

---

## Data Fetching

### ApiClient singleton (`src/lib/api.ts`)

`apiClient` is an `ApiClient` instance from `@strawboss/api`. Configuration:

- `baseUrl`: empty string in dev (proxied via Next.js rewrites), `NEXT_PUBLIC_API_URL` in production
- `getToken`: async function calling `supabase.auth.getSession()` -> `access_token`
- `onApiError`: lazy-imports `clientLogger` and logs failed API calls

### TanStack Query (`src/app/providers.tsx`)

`AppProviders` wraps the app with `QueryClientProvider` using a browser-singleton `QueryClient` (from `src/lib/query-client.ts`). All `@strawboss/api` hooks (e.g. `useTrips`, `useDashboardOverview`, `useBaleProductionStats`) receive `apiClient` as their first argument.

---

## Map Page

### LeafletMap (`src/components/map/LeafletMap.tsx`, ~1028 lines)

Dynamically imports Leaflet + `@geoman-io/leaflet-geoman-free` (no SSR). Satellite base tiles from ArcGIS World Imagery. Default center: Deta, Timis (45.3883, 21.2311).

**Features:**
- **Parcel polygons**: color-coded by `harvestStatus` (planned=orange, harvesting=yellow, harvested=red). Permanent code labels. Click opens popup with edit/delete buttons
- **Machine markers**: typed icons (truck=green, baler=amber, loader=blue) with online/offline ring (15-min threshold). Popup shows operator name, status, "show route" button
- **Deposit polygons**: blue dashed outlines for delivery destinations. Click calls `onDepositSelect`
- **Polygon drawing**: Geoman toolbar for `drawMode='parcel'` (orange) or `drawMode='deposit'` (blue). Callbacks: `onNewParcelDrawn`, `onNewDepositDrawn`
- **Boundary editing**: `handleStartEdit()` enables Geoman edit mode on existing polygon. `handleSave()` calls `useUpdateParcelBoundary()` mutation
- **Route history**: renders a polyline from `routePoints[]` with green start / red end circle markers
- **Navigation**: `navigateToParcelId` / `navigateToMachineId` fly to target and open popup
- **Layer toggles**: checkboxes for parcels, deposits, trucks, balers, loaders
- **Selection mode**: `selectionOnly=true` hides all editing tools (used in modal map pickers)
- **Hidden item support**: `hiddenParcelIds`, `hiddenMachineIds`, `hiddenDepositIds` sets
- **ResizeObserver**: re-invalidates Leaflet on container flex resize

### Supporting map components
- `FilterableFarmList` (`src/components/map/FilterableFarmList.tsx`) -- farm sidebar list with toggle
- `FilterableParcelList` (`src/components/map/FilterableParcelList.tsx`) -- parcel sidebar list with harvest status color coding
- `FilterableMachineList` (`src/components/map/FilterableMachineList.tsx`) -- machine sidebar list with `LiveStatusPill`
- `RouteHistoryPanel` (`src/components/map/RouteHistoryPanel.tsx`) -- date range picker for route history queries
- `DepositGeofenceModal` (`src/components/map/DepositGeofenceModal.tsx`) -- create deposit from drawn polygon
- `KmlImportToFarmModal` (`src/components/map/KmlImportToFarmModal.tsx`) -- batch-import parcels from a KML file into a farm
- `LiveStatusPill` -- live machine status indicator (online/offline + current trip status)

### KML Import (`src/lib/kml-parser.ts`)
Parses KML files to extract polygon boundaries for batch parcel import.

---

## Task Planning

### DailyPlanBoard (`src/components/features/tasks/daily-plan/DailyPlanBoard.tsx`)
Three kanban columns: `AvailableColumn`, `InProgressColumn`, `DoneColumn`. Uses `DayNavigator` for date selection. `DraggablePlanCard` supports drag-and-drop between columns. `AssignmentModal` for creating/editing assignments. `ParcelSelectDropdown` for parcel picker. `ParcelGroup` groups in-progress assignments by parcel. `ParcelMapModal` shows a map for parcel selection.

### MachinePlanBoard (`src/components/features/tasks/machine-plan/MachinePlanBoard.tsx`)
Machine-centric view: lists machines of a given type with their daily assignments. Used on `/tasks/balers` and `/tasks/loaders`.

### TruckPlanBoard (`src/components/features/tasks/machine-plan/TruckPlanBoard.tsx`)
Truck-specific planner with multi-trip course support (Plan C):
- `DepositMapModal` -- map-based deposit geofence selector
- `LoaderPickMapModal` -- map-based loader machine selector for assigning pickup coordinates
- Shows all iterations of a trip course, not just the first trip

### Shared context: `tasks-date-context.tsx`
`TasksDateContext` provides a shared date state across the tasks sub-routes (balers, loaders, trucks).

---

## Reports (`src/app/(dashboard)/reports/page.tsx`)

Four tabs:

1. **Production**: `BaleCountChart` -- custom CSS bar chart showing bale counts by operator/parcel/date using `useBaleProductionStats()` with `ReportFilters` for date range + groupBy
2. **Costs**: `CostBreakdownChart` -- fuel + consumable cost bar chart from `useDashboardCosts()`
3. **Operators**: `OperatorProductionChart` -- per-operator production bars
4. **Km/Truck** (Plan C): `KmPerTruckTab` -- daily km driven per truck chart using `useLocationKmByDay()`

All charts use pure CSS bar rendering (no external chart library).

---

## Dashboard (`src/app/(dashboard)/page.tsx`)

- **KPI cards**: `KpiCard` -- balesToday, activeTrips, activeMachines, pendingAlerts (from `useDashboardOverview()`)
- **Trending chart**: `TrendingChart` -- daily bale/trip counts (from `useDashboardTrending()`)
- **Top operators**: `TopOperators` -- ranked list from `useBaleProductionStats({ groupBy: 'operator' })`
- **Recent trips**: `RecentTrips` -- last 5 trips from `useTrips({ limit: '5' })`

---

## Settings (`src/app/(dashboard)/settings/page.tsx`)

- Profile editing: full name, phone
- Password change: current + new password
- Locale toggle: switches between 'en' and 'ro'
- Notification preferences: toggle switches

---

## i18n (`src/lib/i18n.tsx`)

Custom lightweight i18n (not next-intl despite CLAUDE.md mention):

- `LocaleProvider` wraps the app. Reads from `localStorage('strawboss-locale')`, defaults to 'en'
- Catalogs: `messages/en.json` and `messages/ro.json` imported directly
- `useI18n()` hook returns `{ locale, setLocale, hydrateFromProfile, t }`
- `t(key, params?)` resolves dot-path keys with `{{param}}` interpolation (regex: `/\{\{(\w+)\}\}/g`). Falls back to English if Romanian key missing. Placeholder format is `{{...}}` — do NOT use `{...}` (H-9 fix, commit `de58e10`)
- `normalizeUiLocale(raw)` maps DB locale strings to 'en' or 'ro'
- `ProfileLocaleHydration` component (`src/components/layout/ProfileLocaleHydration.tsx`) calls `hydrateFromProfile()` once after profile fetch (only if no localStorage override)

---

## Realtime

### RealtimeProvider (`src/lib/realtime.tsx`)

Subscribes to a single Supabase channel `db-changes` with 6 postgres_changes listeners:

| Table | Invalidated Query Key |
|---|---|
| `trips` | `queryKeys.trips.all` |
| `task_assignments` | `queryKeys.taskAssignments.all` |
| `alerts` | `queryKeys.alerts.all` |
| `parcel_daily_status` | `queryKeys.parcelDailyStatus.all` |
| `delivery_destinations` | `queryKeys.deliveryDestinations.all` |
| `geofence_events` | `queryKeys.taskAssignments.all` |

**Reconnect with exponential backoff**: on `CHANNEL_ERROR` or `TIMED_OUT`, removes channel, waits `min(1000 * 2^retry, 30000)` ms, re-subscribes. Gives up after `MAX_RETRIES = 10`. On reconnect, invalidates all queries.

### useRealtimeSubscription hook (`src/hooks/useRealtimeSubscription.ts`)
Subscribes a per-component channel to a specific table and invalidates the given query key. Used for fine-grained subscriptions beyond the global provider.

---

## Shared Components

### Layout
- `Sidebar` (`src/components/layout/Sidebar.tsx`) -- nav links, collapsible
- `SidebarLink` (`src/components/layout/SidebarLink.tsx`) -- active-state nav link
- `TopBar` (`src/components/layout/TopBar.tsx`) -- hamburger menu + user info
- `PageHeader` (`src/components/layout/PageHeader.tsx`) -- page title + optional actions

### Shared UI
- `StatusBadge` (`src/components/shared/StatusBadge.tsx`) -- colored pill for trip/assignment/harvest status
- `DataTable` (`src/components/shared/DataTable.tsx`) -- generic table with sorting
- `DocumentViewer` (`src/components/shared/DocumentViewer.tsx`) -- PDF/image preview
- `LoggingErrorBoundary` (`src/components/shared/LoggingErrorBoundary.tsx`) -- React error boundary that logs to `clientLogger`
- `SearchInput` (`src/components/shared/SearchInput.tsx`) -- debounced search field
- `SignatureDisplay` (`src/components/shared/SignatureDisplay.tsx`) -- renders base64 signature images
- `UserPresenceDot` (`src/components/shared/UserPresenceDot.tsx`) -- green/grey dot indicator based on `user.lastSeenAt` within `ONLINE_WINDOW_S`. Tooltip localized via `useI18n()` (Plan C, H-8 fix)
- `TripTimeline` (`src/components/shared/TripTimeline.tsx`) -- visual timeline of trip state transitions
- `MachineCard` / `ParcelCard` -- compact card views for machines and parcels

### Utility
- `normalize()` (`src/lib/normalize-api-list.ts`) -- normalizes API list responses (handles both array and `{ data: [] }` formats)
- `clientLogger` (`src/lib/client-logger.ts`) -- batches browser logs to `POST /api/client-log`
- Client log route (`src/app/api/client-log/route.ts`) -- Next.js API route that writes client logs to the server-side Winston logger

---

## Swarm / Deployment Notes

### `/healthz` liveness probe (`src/app/healthz/route.ts`)

A dependency-free `GET /healthz` → `200 { status: 'ok' }` route used by the Docker Swarm healthcheck on the `admin-web` service. It is:

- **`dynamic = 'force-static'`** — the standalone server answers from the build-time cache without invoking the React renderer or any data fetch, so it returns immediately even when the app is still warming up.
- **Auth-free and public** — no Supabase session is checked.

### `next.config.ts` — `experimental.preloadEntriesOnStart: false`

Next.js 16 standalone mode preloads all route entries on server start by default (`preloadEntriesOnStart: true`). That preload is CPU-heavy and, under container/orchestration CPU contention, can delay the moment the HTTP socket actually binds by 30–120 s — despite the misleading "Ready in 0ms" banner — causing the Swarm healthcheck to fail and crash-loop the container.

Setting `experimental.preloadEntriesOnStart: false` makes the server bind in ~1 s and load routes lazily on first request. This is the correct behavior for a health-gated rolling deploy on an internal admin dashboard.

### `HOSTNAME=0.0.0.0` (docker-stack.yml)

The `admin-web` Swarm service sets `HOSTNAME=0.0.0.0` in its environment. Next.js standalone uses `HOSTNAME` to decide which interface to bind; without it, Next.js binds only the container's own IP, which is not reachable from the overlay network's load-balancer. Setting it to `0.0.0.0` ensures the server listens on all interfaces inside the container.

---

## Related Docs

- [Backend](backend.md) -- API endpoints consumed by this app
- [Mobile App](mobile.md) -- complementary field-worker interface
