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
- `FilterableParcelList` (`src/components/map/FilterableParcelList.tsx`) -- parcel sidebar list
- `FilterableMachineList` (`src/components/map/FilterableMachineList.tsx`) -- machine sidebar list
- `RouteHistoryPanel` (`src/components/map/RouteHistoryPanel.tsx`) -- date range picker for route history queries
- `DepositGeofenceModal` (`src/components/map/DepositGeofenceModal.tsx`) -- create deposit from drawn polygon

### KML Import (`src/lib/kml-parser.ts`)
Parses KML files to extract polygon boundaries for batch parcel import.

---

## Task Planning

### DailyPlanBoard (`src/components/features/tasks/daily-plan/DailyPlanBoard.tsx`)
Three kanban columns: `AvailableColumn`, `InProgressColumn`, `DoneColumn`. Uses `DayNavigator` for date selection. `DraggablePlanCard` supports drag-and-drop between columns. `AssignmentModal` for creating/editing assignments. `ParcelSelectDropdown` for parcel picker. `ParcelGroup` groups in-progress assignments by parcel. `ParcelMapModal` shows a map for parcel selection.

### MachinePlanBoard (`src/components/features/tasks/machine-plan/MachinePlanBoard.tsx`)
Machine-centric view: lists machines of a given type with their daily assignments. Used on `/tasks/balers` and `/tasks/loaders`.

### TruckPlanBoard (`src/components/features/tasks/machine-plan/TruckPlanBoard.tsx`)
Truck-specific planner with:
- `DepositMapModal` -- map-based deposit geofence selector
- `LoaderPickMapModal` -- map-based loader machine selector for assigning pickup coordinates

### Shared context: `tasks-date-context.tsx`
`TasksDateContext` provides a shared date state across the tasks sub-routes (balers, loaders, trucks).

---

## Reports (`src/app/(dashboard)/reports/page.tsx`)

Three tabs:

1. **Production**: `BaleCountChart` -- custom CSS bar chart showing bale counts by operator/parcel/date using `useBaleProductionStats()` with `ReportFilters` for date range + groupBy
2. **Costs**: `CostBreakdownChart` -- fuel + consumable cost bar chart from `useDashboardCosts()`
3. **Operators**: `OperatorProductionChart` -- per-operator production bars

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
- `t(key, params?)` resolves dot-path keys with `{{param}}` interpolation. Falls back to English if Romanian key missing
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
- `TripTimeline` (`src/components/shared/TripTimeline.tsx`) -- visual timeline of trip state transitions
- `MachineCard` / `ParcelCard` -- compact card views for machines and parcels

### Utility
- `normalize()` (`src/lib/normalize-api-list.ts`) -- normalizes API list responses (handles both array and `{ data: [] }` formats)
- `clientLogger` (`src/lib/client-logger.ts`) -- batches browser logs to `POST /api/client-log`
- Client log route (`src/app/api/client-log/route.ts`) -- Next.js API route that writes client logs to the server-side Winston logger

---

## Related Docs

- [Backend](backend.md) -- API endpoints consumed by this app
- [Mobile App](mobile.md) -- complementary field-worker interface
