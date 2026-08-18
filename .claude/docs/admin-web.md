---
type: doc
title: "Admin Web (apps/admin-web)"
created: 2026-04-16
updated: 2026-08-18
tags: [doc, frontend, layer, nextjs]
status: mature
related:
  - "[[architecture]]"
  - "[[packages-api]]"
  - "[[packages-ui-tokens]]"
  - "[[backend]]"
  - "[[feature-toggles]]"
---

<!-- updated 2026-08-18: third UI language (Hungarian, `hu`) -- `messages/hu.json` (2223 leaves,
     structural + untranslated parity enforced by rewritten check-i18n-parity.mjs, --strict green);
     LangToggle shared component replaces 3 hardcoded ro/en copies; new useLocaleFormat hook replaces
     6 `locale === 'ro' ? 'ro-RO' : 'en-US'` ternaries; i18n.tsx/normalizeUiLocale now driven by
     SUPPORTED_LOCALES (@strawboss/types) instead of a hardcoded 2-locale union. See [[packages-types]]
     "Locale" and [[backend]] "Server-Side i18n". -->
<!-- updated 2026-07-31: last 13 feature switches wired (57/57, e275b3c) -- shared `ExportButton`
     (src/components/shared/ExportButton.tsx) replaces 11 independent `analytics.export` checks across
     7 report tabs + reports page (CSV/PDF) + transporter XLSX export; 5 report tabs gated on
     `analytics.report_operators` (MachineProductionTab/KmPerTruckTab deliberately excluded, per-machine
     not per-operator); super-admin org console gets a `uiOnly` badge on registry rows. See
     [[feature-toggles]] for the full per-org feature-toggle system. -->
<!-- updated 2026-07-27: "Curse" merges Solicitări curse into one page with two ledgers (AuxTripSection/AuxTripTable, AuxStage from @strawboss/domain, realtime for trip_requests); /trip-requests is now a redirect to /trips#aux; new web-only `transportator` role ((transporter) route group: My trips / New request / Beneficiari, auto-generated comandă PDF); force-status now requires a real load source (ForceStatusLoadFields); ParcelMapModal + LeafletMap gain multi-select field picking and bulk-add; richer available-machine cards (operator photo, aux company/contact, live locality via new geocode cache) and loader info panel; custom single-field vertex-edit tool on the map -->
<!-- updated 2026-07-12: Trip Requests — CmrUploadModal (admin CMR-scan override) + accessible-dialog pattern in AvizUploadModal/CmrUploadModal; documents.types.* i18n replaces hardcoded type-label maps (adds cmr_scan); UserPresenceDot default window 90s -> 180s -->
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
| `/trips` | `(dashboard)/trips/page.tsx` | 100% | "Curse" — merged page, two ledgers: auxiliary (external transporters, keyed on the request) on top, own-fleet (`isAuxiliary=false`) below. Absorbed the former `/trip-requests` page (see Curse / Auxiliary Ledger below) |
| `/trips/[tripId]` | `(dashboard)/trips/[tripId]/page.tsx` | 100% | Trip detail with TripTimeline, TripDetail component. TripDetail's force-status control now requires a load source (parcel or depot) + bale count when the target status implies cargo is on the truck (`ForceStatusLoadFields`) |
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
| `/documents` | `(dashboard)/documents/page.tsx` | 100% | Document list with type filters (labels via i18n `documents.types.*`, includes `cmr_scan`) |
| `/documents/[documentId]` | `(dashboard)/documents/[documentId]/page.tsx` | 100% | DocumentViewer for PDF/image preview |
| `/trip-requests` | `(dashboard)/trip-requests/page.tsx` | redirect | **No longer a page.** `redirect(`/${slug}/trips#aux`)`. Kept (not deleted) so bookmarks/chat links/SMS-email prose referencing it keep working; the sidebar entry is gone. All 665 lines of UI moved into `/trips` (see Curse / Auxiliary Ledger below) |
| `/accounts` | `(dashboard)/accounts/page.tsx` | 100% | Admin user management (list, create, edit, deactivate). Also hosts `AssignBeneficiariesModal` for `transportator` accounts (multi-select which `Beneficiary` rows a transporter may act for — set-replace `PUT`, mirrors `AssignDepotModal`) |
| `/settings` | `(dashboard)/settings/page.tsx` | 100% | Profile editing, password change, locale toggle, notification prefs |
| `/deposits` | `(dashboard)/deposits/page.tsx` | 100% | Delivery destination management (Plan C — previously under `/delivery-destinations`) |
| `/command-center` | `(dashboard)/command-center/page.tsx` | 100% | Multi-trip board with `UserPresenceDot` for live operator presence (Plan C) |

### Transporter area (`src/app/[slug]/(transporter)/`)

A separate, minimal route group that coexists with `(dashboard)` under the same `[slug]` dynamic segment (route groups don't affect the URL). It is the **only** UI for the web-only `transportator` account type — an external haulier account with no mobile app access (`transportator` is in mobile's `NON_FIELD_ROLES`). Full auth/session logic is re-implemented in `TransporterLayout` (it is a sibling group, not wrapped by `(dashboard)/layout.tsx`): checks `supabase.auth.getSession()`/`onAuthStateChange`, resolves the org slug, and additionally gates on role — `app_metadata.role !== 'transportator'` bounces to the admin dashboard root. Login (`(auth)/login/page.tsx`) also branches on the same role to land a transporter on `/transport` instead of `/`. All of this is belt-and-suspenders UX; the real boundary is the backend `@Roles(transportator)` guard + RLS.

`TransporterHeader` renders a 3-item nav (Truck/`nav.transportTrips`, FilePlus2/`nav.transportNew`, Building2/`nav.transportBeneficiaries`) — no admin Sidebar.

| Route | File | Description |
|---|---|---|
| `/transport` | `transport/page.tsx` | "My trips" — the transporter's own read-only ledger, scoped server-side to `trip_requests.created_by_user_id`. Reuses `buildAuxRows` + `AuxTripTable` in `readOnly` mode (no confirm/cancel/unplan) via `useTransporterRequests`; row click opens `RequestDetailsModal`. Aviz/CMR chips ARE clickable here (own-request upload, see below) and a 3rd chip opens `ComandaModal` |
| `/transport/new` | `transport/new/page.tsx` | Authenticated copy of the public beneficiary request form (Form B), minus the PIN — scoped to the beneficiaries an admin assigned. Full CRUD on saved contacts/trucks/drivers via `TransporterRecordModal` / `TransporterRecordDeleteDialog`. Shares `insertBeneficiaryRequest()` with the public PIN portal (`/[slug]/request/[beneficiarySlug]`), which is untouched |
| `/beneficiari` | `beneficiari/page.tsx` | Per-beneficiary "order settings" that feed the auto-generated comandă PDF: transport value + currency, payment term (default 30 days), standard bale count/dimensions, goods name, truck description, loading locality/country, OBS. `useTransporterBeneficiaries` (assigned list) + `useBeneficiaryOrderSettings` / `useSaveBeneficiaryOrderSettings`, gated server-side by `assertAssigned` |

**Own-request document upload:** `AvizUploadModal` / `CmrUploadModal` take a `variant?: 'admin' | 'transporter'` prop that only swaps the endpoint (`useUploadAviz`/`useRequestAvize`/`useUploadCmrScan`/`useRequestCmrScans` all take the same `variant`, default `'admin'`). Backend ownership check is `TripRequestsService.assertCreatedBy` (`created_by_user_id = caller`). No modal duplication — admin call sites are unchanged.

**`ComandaModal`** (`transport/ComandaModal.tsx`): view/download/regenerate the auto-generated "comandă" (transport order) PDF for one request — `useTransporterComanda` / `useGenerateTransporterComanda`. The comandă is generated automatically on request submit (best-effort, no-op if the beneficiary has no order settings yet); a missing comandă renders a prominent amber alert box with a direct link to `/beneficiari`, and a generation error renders as a red banner with the server's message (not a faint inline line). The doc-chip in `RequestDocChips` mirrors this urgency: green+check when present, **red and `animate-pulse`** with an `AlertTriangle` icon when missing — a trip with no order must stand out in the ledger. `DocumentType.comanda` is a third, distinct document type alongside `cmr_scan`/`cmr` — see [[packages-types]].

**`useIsTransportator()`** (`src/hooks/useIsTransportator.ts`) — `{ isTransportator, isLoading }` from `useProfile()`, mirroring `useIsDispatcher()`'s loading-vs-false split.

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
| `/super-admin/organizations/[id]` | `organizations/[id]/page.tsx` | Per-org feature-toggle console — registry tree editor with live cascade preview and preset buttons. Full system: [[feature-toggles]]. As of `e275b3c`, rows where `def.uiOnly` is true (7 keys, e.g. `analytics.export`, `analytics.report_operators`) carry a small pill (`superAdmin.features.uiOnly`, `title` tooltip `superAdmin.features.uiOnlyHint`) next to the surfaces/cascade line, so an operator can't mistake "hides a control" for "revokes access to the data" |
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
- **Multi-select highlighting**: `selectedParcelIds?: Set<string>` — when set, highlights ALL matching parcels (not just one), used by the multi-select field pickers (`ParcelMapModal`, the truck-task bulk-add flow)
- **Polygon drawing**: Geoman toolbar for `drawMode='parcel'` (orange) or `drawMode='deposit'` (blue). Callbacks: `onNewParcelDrawn`, `onNewDepositDrawn`
- **Boundary editing**: a custom **"Edit a field" pick tool** (not Geoman's global edit-mode button, which used to drop draggable vertices on *every* parcel at once) arms a pick mode — crosshair cursor + hint bar — click one field and only that field's boundary becomes editable, routed into the existing `editingId` + Save/Cancel flow. `handleStartEdit()` renders the live (draggable) shape as a separate orange overlay layer and **hides the base polygon underneath it** (previously the base polygon could repaint over the edit layer on a refetch, making a dragged vertex look like it snapped back). Geoman's rotate tool is disabled (unused here). `handleSave()` calls `useUpdateParcelBoundary()` mutation
- **Route history**: renders a polyline from `routePoints[]` with green start / red end circle markers
- **Navigation**: `navigateToParcelId` / `navigateToMachineId` fly to target and open popup
- **Layer toggles**: checkboxes for parcels, deposits, trucks, balers, loaders
- **Selection mode**: `selectionOnly=true` hides all editing tools (used in modal map pickers)
- **Hidden item support**: `hiddenParcelIds`, `hiddenMachineIds`, `hiddenDepositIds` sets
- **ResizeObserver**: re-invalidates Leaflet on container flex resize

**`ParcelMapModal` multi-select (`components/features/tasks/daily-plan/ParcelMapModal.tsx`):** `onSelect` is now `(parcelIds: string[]) => void` — clicking toggles a parcel in/out of a local `Set` instead of closing the modal on the first click; the caller reads `Array.from(selectedIds)` on submit. Single-select callers (`AssignmentModal.tsx`, `BaleProductionCard.tsx`, `ConfirmRequestModal.tsx`'s field picker) adapt to the array contract without changing their own single-id logic (e.g. take `ids[0]`).

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

**Bulk-add multi-selected fields:** the "Select on map" button opens `ParcelMapModal` in multi-select mode; on submit, all toggled parcel ids are sent through `useBulkCreateTaskAssignments` (was wired but unused before) as a single request instead of one `useCreateTaskAssignment` call per field — picking several adjacent fields for one machine no longer fires N requests.

**"Select on map" click-through fix:** on the loader/baler board this button used to live only inside the `addMode === 'field'` block, as a sibling of `FarmParcelCascade`. The cascade closes itself on a document `mousedown` outside-click, which unmounted that block (and the button) *before* the button's own `click` handler could fire, so `setShowParcelMap(true)` never ran. Fixed by (a) moving the button into the always-visible chooser row, gated to appear only after "Câmp" is picked (mirrors the depot-picker flow), and (b) marking it `data-cascade-keep-open` so `FarmParcelCascade`'s outside-click check ignores it. **Pattern to reuse:** any button that must survive being a sibling of `FarmParcelCascade` needs `data-cascade-keep-open`.

### TruckPlanBoard (`src/components/features/tasks/machine-plan/TruckPlanBoard.tsx`)
Truck-specific planner with multi-trip course support (Plan C):
- `DepositMapModal` -- map-based deposit geofence selector
- `LoaderPickMapModal` -- map-based loader machine selector for assigning pickup coordinates
- Shows all iterations of a trip course, not just the first trip

**Richer loader info panel (`LoaderPickMapModal`):** clicking a loader marker now shows the operator name, a live GPS status badge (`UserPresenceDot`), and the field(s) the loader is already assigned to today — not just the machine code/plate. The per-loader today's-fields map (`parcelsByLoaderMachineId: Map<machineId, string[]>`) is computed in `TruckPlanBoard` from the widened local `Assignment` type (now carrying `parcelId`/`parcelName`, which the backend already returned) and passed down as a prop.

### Richer available-machine cards (loaders/balers/trucks left-hand panel, `MachinePlanBoard.tsx` + `TruckPlanBoard.tsx`)

Each card now shows, beyond code + registration plate (em-dash fallback when blank):
- **Own-fleet machine:** the assigned operator's name + their **real uploaded photo only** — `UserAvatar` with `hideFallback`, never a default/initials tile. Backend: `machines.list()` now returns `assignedOperatorName` / `assignedOperatorAvatarUrl` via subqueries (`packages/types` `Machine`).
- **Aux truck** (`isAuxiliary`): company name + contact person shown directly on the card (`Building2`/`User` icons), sourced from data `useMachines` already returned.
- **"near `<locality>`"** line when the machine's last GPS fix is fresh (< 15 min, `MACHINE_ONLINE_MS`): clicking it opens `MachineLocationMapModal` — a read-only map centered on the machine (reuses `LeafletMap`'s `navigateToMachineId`). Locality comes from a new server-side reverse-geocode cache: `GeocodeService` (backend) resolves misses via Nominatim, caches by ~110 m-rounded coordinate key (`geocode_cache`, migration `00089`, service-role RLS only), rate-limited and resolved off the request path — a missing table or geocode error never breaks `/location/machines`. `MachineLastLocation.locality` carries it through.

### Shared context: `tasks-date-context.tsx`
`TasksDateContext` provides a shared date state across the tasks sub-routes (balers, loaders, trucks).

---

## Curse / Auxiliary Ledger (`src/app/[slug]/(dashboard)/trips/page.tsx`)

"Curse" merged the former `/trip-requests` page into `/trips` as **two delimited ledgers on one page**, not one table with a union type:

- **Auxiliary** (top): external transporters. The row is keyed on the `trip_requests` **request**, not the trip — an auxiliary transport is born as a request and its `trips` row is only materialized once a dispatcher assigns a truck, so the request id is the only identity stable across the entity's whole life.
- **Own-fleet** (bottom, `id="fleet"`): `isAuxiliary=false` trips, rendered by the existing `TripList`.

They are intentionally **not** merged into one column set: fleet goods flow field→depot, aux flows depot→customer yard; aux is a collapsed lifecycle (`planned → loaded → completed`, no depart/arrive/deliver); and the two status vocabularies are disjoint (an aux row can never reach `in_transit`). Each ledger keeps its **own** status/stage `<select>`. Two independent server-scoped queries — never a client-side split of one fetch, or a busy fleet would starve the aux table's `LIMIT 1000`.

`/trip-requests` still resolves (see Pages Inventory) but only as a redirect; the sidebar link is gone.

### AuxStage (`packages/domain/src/rules/aux-stage.ts`)

An aux transport lives on two axes that neither alone can describe: `trip_requests.status` (pending/confirmed/cancelled — frozen at `confirmed` once `confirm()` runs) and `trips.status` (`TripStatus` — doesn't exist until a trip is materialized, which can be days later). `composeAuxStage({ status, tripStatus, tripSignedAt, tripCompletedAt })` collapses both into one `AuxStage` enum (`packages/types/src/entities/trip.ts`):

```
pending → unplanned → planned → loading → awaitingSignature → signed → completed   (+ cancelled)
```

Rules: no trip ⇒ `unplanned`; once a trip exists, the **trip** wins (the request axis is stale by construction); `loaded` splits into `awaitingSignature` / `signed` because the external driver still owes a paper-CMR signature via the one-time public link. `AUX_STAGE_ORDER` / `ACTIVE_AUX_STAGES` (types) give the numeric ordinal and the "still live" subset. `unplanned` is the payoff state this design makes visible: confirmed, a one-time truck minted, nobody has scheduled it yet — no timeout, no alert, previously unrepresentable. `AuxStageBadge` (`components/features/trip-requests/AuxStageBadge.tsx`) color-codes it: amber=owed action, blue=in motion, violet=awaiting external signature, emerald=done, neutral=cancelled.

### Row model: `AuxRow` (`src/lib/aux-rows.ts`)

`buildAuxRow(request)` / `buildAuxRows(requests)` compose the stage and flatten a numeric `stageOrder` (DataTable sorts with `row[sortKey]` and has no accessor — sorting the enum string alphabetically would be meaningless) plus flat sort mirrors (`requesterName`, `truckPlate`, `driverName`, …). `AuxRow.request` carries the full `TripRequest` through untouched so confirm/cancel/aviz/CMR/details need no rewiring. `AuxRow extends Record<string, unknown>` on purpose — widening `DataTable`'s existing generic would recompile six unrelated tables for nothing.

### `AuxTripSection` (`components/features/trips/AuxTripSection.tsx`)

Owns the `useTripRequests` call and is mounted by the page **only for admin/dispatcher** (`useIsDispatcher()` → `{ isDispatcher, isLoading }`, a placeholder renders while loading so a hard-reload never briefly shows "nothing to confirm"). `GET /trip-requests` is `@Roles(admin, dispatcher)` while `GET /trips` has no role guard, so an operator signed in on the web must never fire the admin-only query.

Two separate queries inside the section:
- **Intake strip**: `useTripRequests(apiClient, { status: RequestStatus.pending })` — always fetched whole, unfiltered by the page's date/search bar. Pending requests are unactioned work; inheriting the page filters would let a request silently vanish (date bar = "today" hides one submitted at 22:00 last night; the ledger's 200-row cap would drop an old one). Rendered as `AuxIntakeCard`s (decision cards, not table rows — confirming needs the whole picture at once).
- **Ledger**: `useTripRequests(apiClient, filters)` filtered by search/date, capped 200 rows, stage-filterable via a `<select>` defaulting to `ACTIVE` (a sentinel hiding `cancelled`/`completed`). `pending` is deliberately **excluded** from the stage options — a pending request is a card above, never a row, so offering it would only ever show an empty table under N visible cards (reads as data loss).

### `AuxTripTable` (`components/features/trips/AuxTripTable.tsx`)

Columns: stage (`AuxStageBadge`, sorted on `stageOrder`), requester (company + name), truck (plate — always read from the **request**, never the machines row: the one-time aux machine is a copy, soft-deleted the moment the load is registered), driver (name + `tel:` link), crop/quality, pickup (parcel-or-depot label — see field-sourced pickup below), destination (the request's own `destinationLocality`/`destinationAddress`, never `trips.destination_name`, which is a heuristic that can literally render "Adresă solicitant"), needed date, trip number/link (with a bale count once loaded, and a red `AlertTriangle` badge when `tripCount > 1`), documents (`RequestDocChips`), and actions. No `tonsRequested` column — the beneficiary portal dropped that field from its form, so it's structurally blank for most rows; still shown on the intake card/details modal when a request does carry one.

**Un-plan vs. cancel — one trash icon, two escalating meanings:**
- Row has a live trip → **un-plan**: `useDeleteTrip` on the trip. Backend transactionally soft-deletes the trip + its originating truck task and clears `trip_requests.trip_id`; the request falls back to `unplanned` ("Confirmată — neplanificată") and stays in this table, ready to be re-assigned on the truck board (the answer to "the truck broke down"). The aux machine itself is untouched. `useDeleteTrip` only invalidates `trips.*`, so `AuxTripSection` explicitly invalidates `queryKeys.tripRequests.all` + `taskAssignments.all` in `onSuccess` or the row would keep showing a dead trip number.
- Row has no trip yet → **cancel the request** (`CancelRequestModal`, reused from the intake cards) — a confirmed-but-unplanned request can now be cancelled too (previously a hard dead end with ~20 stranded rows in prod); cancelling also retires the request's one-time auxiliary truck. If a trip HAS been planned, the backend refuses cancel with a machine-readable `has_live_trip` — un-plan first.

There is deliberately **no delete** action on an aux row at all (own-fleet trips keep theirs, gated `canDelete={isDispatcher}` in `TripList`) — deleting an aux trip directly used to strand the request with a dead `trip_id` and leave the loader's phone reading "Camionul auxiliar nu are o cursă activă" forever; that hazard is now structurally unreachable.

`AuxTripTable` also powers the **transporter's read-only ledger** (see Transporter area above) via `readOnly` (no actions column; doc chips render static only when no upload handler is wired), `onRowClick`, and `onViewComanda` — one component, no duplication.

### Confirm modal — field-sourced pickup (`ConfirmRequestModal.tsx`)

Confirming a pending request mints the one-time auxiliary truck and requires exactly one pickup point, chosen via a **Depot / Field tab pair** (`Warehouse` / `Sprout` icons): depot is a plain `<select>`; field reuses `FarmParcelCascade` (the same farm→parcel cascade used elsewhere) plus a "Select on map" button that opens `ParcelMapModal` in single-select mode. `useConfirmTripRequest` is called with either `{ id, depotId, internalCode }` or `{ id, parcelId, internalCode }`. `RequestDetailsModal` and `AuxTripTable`'s pickup column both show whichever the request actually has (falling back from the live trip's resolved `tripSourceParcelName`/`tripSourceDepotName` to the request's own `sourceParcelName`/`sourceDepotName` — what actually happened beats what was planned).

### Force-status now books a real load (`TripDetail.tsx`, `ForceStatusLoadFields.tsx`)

Forcing a trip's status used to write only the status + one timestamp, producing phantom trips: status said `loaded`, `bale_count` stayed 0, no `bale_loads` row, no stock movement. Now, when the target status implies cargo is on the truck (`loaded`/`in_transit`/`arrived`/`delivering`/`delivered`/`completed`) and the trip has no load recorded yet, `ForceStatusLoadFields` requires the admin to pick a source — **parcel XOR depot** (tab UI, `Sprout`/`Warehouse` icons, backed by `useParcels`/`useDeliveryDestinations`) — and a positive integer bale count (`isLoadComplete()` gates the submit button). The server rejects an incomplete request with a machine-readable `load_required`, surfaced via `isLoadRequiredError()` as `trip_detail.forceStatus.loadRequired`. If a real load was already registered, nothing is asked. Depot stock (deposit-inventory / delivery-destinations / reports) now also subtracts outbound `bale_loads.source_depot_id` rows — previously stock was inbound-only and overstated.

### Aviz / CMR-scan document upload

Each aux row exposes shared `RowActions` — view details, upload Aviz, upload CMR scan — with distinct icons (`FileText` for aviz, `ScanLine` for CMR).

- **Aviz** (`AvizUploadModal.tsx`) — delivery-note PDF. `TripRequest.hasAviz` (server-computed from `documents.document_type = 'delivery_note'`) flips the row button green. Client-side size cap `MAX_UPLOAD_BYTES = 10 MiB`, mirroring the backend's `AVIZ_MAX_BYTES`. Data via `useRequestAvize` / `useUploadAviz` (`GET`/`POST /api/v1/trip-requests/:id/aviz`, or the ownership-scoped transporter endpoint via `variant='transporter'` — see Transporter area).
- **CMR scan** (`CmrUploadModal.tsx`) — the physical paper CMR that the loader normally photographs from the phone at the end of an auxiliary load (see [[mobile]]); this modal is the admin's (or transporter's own-request) manual upload/replace override for when that didn't happen or produced an unusable scan. `TripRequest.hasCmrScan` (server-computed from `document_type = 'cmr_scan'`) flips the row button green. Client-side size cap `MAX_UPLOAD_BYTES = 15 MiB`, mirroring the backend's `CMR_SCAN_MAX_BYTES`. Data via `useRequestCmrScans` / `useUploadCmrScan` (`GET`/`POST /api/v1/cmr-scans/trip-request/:id`).

Both modals share the same shape: PDF-only (client extension/MIME check; backend additionally sniffs the `%PDF-` magic byte), single-document-per-request (uploading replaces the prior one — soft-deleted server-side — a `window.confirm()` warns before overwriting), and an **accessible dialog pattern**: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the panel, focus moves to the close button on mount and is restored to the previously-focused trigger on unmount, and `Escape` closes the modal (`onClose` read through a ref so the mount effect only runs once).

`DocumentType.cmr_scan` is a distinct type from the backend-generated `DocumentType.cmr` (the CMR the backend itself generates via Puppeteer, stage 1/2) — they intentionally don't share a slot. `DocumentType.comanda` (the transporter's auto-generated order PDF, see Transporter area) is a third, disjoint type. See [[packages-types]].

### Realtime wiring

`trip_requests` is now a listened table on the shared `db-changes` channel (`src/lib/realtime.tsx`) — previously absent entirely, so a new portal request needed an F5 to appear. The existing `trips` handler now **also** invalidates `queryKeys.tripRequests.all`, because an aux row's stage is composed from its joined live trip: a trip status change mutates the aux read model, not just the trips list. Fail-safe either way — if the table turns out not to be in the `supabase_realtime` publication, the handler is an inert no-op and the ledger still self-heals via `refetchOnWindowFocus` + mutation-success invalidation.

### Security fix: no more leaking the CMR signing token

`GET /trips` (list + detail) used to `SELECT t.*`, which shipped `public_sign_token` — the one-time secret behind an aux trip's public CMR-signing link — to every authenticated user, since that endpoint carries no `@Roles` at all. Both endpoints now use an explicit column projection; `public_sign_token` is also gone from the `Trip` type and `src/lib/trip-mapper.ts`, so it cannot be reintroduced by accident.

---

## Reports (`src/app/[slug]/(dashboard)/reports/page.tsx`)

Ten tabs (`TABS` array, each with an optional `feature` gate — see below): Farms, Fields, Depots,
Rankings, Costs (`costs.report`), Operators (`analytics.report_operators`), Production/machine
(`MachineProductionTab`), Km/truck (`KmPerTruckTab`), Km/operator (`KmPerOperatorTab`,
`analytics.report_operators`), Connected hours (`ConnectedHoursTab`, `analytics.report_operators`).

All charts use pure CSS bar rendering (no external chart library).

### Per-tab gating on `analytics.report_operators` (`e275b3c`)

`analytics.report_operators` is a `uiOnly` feature (full system: [[feature-toggles]]) — some orgs must
contractually not expose per-operator tracking. Five tabs carry `feature: 'analytics.report_operators'`
in the page's `TABS` array and are hidden from the tab strip (and their panel unreachable) when the
flag is off: `ConnectedHoursTab`, `DepotReportTab`, `FarmReportTab`, `FieldReportTab`,
`KmPerOperatorTab`.

**`MachineProductionTab` and `KmPerTruckTab` are deliberately NOT gated by this flag** — they report
per-*machine*, not per-operator, and `analytics.report_operators` exists specifically for organizations
that must not track individual people, not machines. This is an intentional, correctness-relevant
distinction (see the comment above the `TABS` array in `reports/page.tsx`) — do not add them to the
gate later without checking with the team.

Two supporting mechanics in `ReportsPage`:
- **`ready` guard**: `useFeatures()`'s `ready` gates the tab-strip filter so it renders every tab (fail
  open) until the profile resolves, then filters — without it the strip would visibly reflow right
  after load.
- **Reset effect**: when the selected tab becomes hidden (its flag flipped, or on initial load before
  `ready`), a `useEffect` reselects the first visible tab. The tabs are separate `{tab === 'x' && ...}`
  blocks rather than array-driven, so without this an orphaned panel could render with no strip item
  highlighted.

### `ExportButton` — one gate for every export trigger (`src/components/shared/ExportButton.tsx`, `e275b3c`)

Replaces eleven independent `analytics.export` checks (or, in some cases, none at all) that used to
live at each call site: the 7 report tabs above, the Costs and Operators tab exports and the PDF export
in `reports/page.tsx` itself, and the transporter XLSX export
(`[slug]/(transporter)/transport/page.tsx`). Gating eleven call sites independently was eleven chances
to miss one, and a missed one leaks exactly the capability the flag is supposed to withhold.

Calls `useFeatures().isEnabled('analytics.export')` internally and **renders `null`, not a disabled
button**, when the feature is off — a visible-but-greyed control invites a support ticket asking why it
doesn't work, an absent one doesn't. Takes `{ label, onClick, disabled?, variant?: 'csv' | 'pdf',
className? }`; `disabled` is a distinct concept ("nothing to export yet"), not the feature gate. PDF is
gated by the same key as CSV — it's the same act (taking the org's data out of the product) and
splitting it under its own key would leave the customer who didn't buy exports a working PDF button.
When adding a new exportable view, use this component rather than a bespoke `analytics.export` check.

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
- Locale toggle: three-way switch (`Română` / `English` / `Magyar`, via `LangToggle` — see below)
- Notification preferences: toggle switches

---

## i18n (`src/lib/i18n.tsx`)

Custom lightweight i18n (not next-intl despite CLAUDE.md mention). **Trilingual since Aug 2026** (`ro`/`en`/`hu`, was bilingual `ro`/`en`) — driven entirely by `SUPPORTED_LOCALES` from `@strawboss/types` (see [[packages-types]] "Locale"), not a hardcoded union.

- `LocaleProvider` wraps the app. Reads from `localStorage('strawboss-locale')`, defaults to `'en'`.
- Catalogs: `messages/{en,ro,hu}.json`, imported directly and assembled into `Record<Locale, …>` — that map (not a `switch`/if-chain) is what won't compile if a locale is added to the SSOT without a matching catalog file existing.
- `useI18n()` hook returns `{ locale, setLocale, hydrateFromProfile, t }`.
- `t(key, params?)` resolves dot-path keys, two-pass interpolation via the shared `interpolate()` helper (`src/lib/interpolate.ts`, extracted so it's unit-testable and shared with the mobile-matching contract test below): `{{param}}` replaced (or emptied if missing, legacy behaviour), then `{param}` replaced but **left untouched** when there's no matching param (so a literal brace, e.g. `settings.organization.accessCodeHint`'s `{slug}`, survives). Falls back to English if the current-locale key is missing.
- `normalizeUiLocale(raw)` maps a DB/localStorage locale string to a supported `Locale`, derived from `SUPPORTED_LOCALES.find(...)`. Falls back to `'en'` — **deliberately not `DEFAULT_LOCALE` (`'ro'`)**: admin-web has always defaulted unset accounts to English and mobile has always defaulted to Romanian; unifying the two would be an unrequested behaviour change.
- `ProfileLocaleHydration` component (`src/components/layout/ProfileLocaleHydration.tsx`) calls `hydrateFromProfile()` once after profile fetch (only if no localStorage override).
- **`LangToggle`** (`src/components/shared/LangToggle.tsx`, added Aug 2026): the language switcher for unauthenticated public entry points (login, request portals). Used to exist as three byte-identical hardcoded ro/en copies; now a single component that maps `SUPPORTED_LOCALES` — adding a locale needs no edit here.
- **`useLocaleFormat()`** (`src/lib/use-locale-format.ts`, added Aug 2026): one hook replacing six scattered `locale === 'ro' ? 'ro-RO' : 'en-US'` ternaries (which silently fell through to the US format for any third locale — MM/DD/YYYY dates, `1,234.56` grouping, in an otherwise-Hungarian UI). Returns `{ tag, date, dateTime, time, number, compare }` — `Intl.DateTimeFormat`/`NumberFormat`/`Collator` instances built from `LOCALE_BCP47[locale]`, memoized on `locale`. `compare` is an `Intl.Collator` (needed for Hungarian digraphs — cs/dz/gy/ly/ny/sz/ty/zs — and ő/ű). Timezone stays `Europe/Bucharest` (`ROMANIA_TZ`) regardless of interface language — the language doesn't move the operation.

### Catalog quality gate (`scripts/check-i18n-parity.mjs`, rewritten Aug 2026)

Runs as part of `./strawboss.sh typecheck admin-web` (wired in `scripts/04-build.sh`). Previously hardcoded `'en.json'`/`'ro.json'` as literals and checked only key-set parity, so a `hu.json` clone of English with zero translation would have passed silently. Now:

- **Discovers** locales by scanning `messages/*.json` for a bare two-letter filename (`/^[a-z]{2}$/`) — adding a locale needs no script edit, only dropping the file. A non-matching `*.json` (e.g. an editor's stray `en.backup.json`) is ignored but the ignore is announced on stderr.
- **Two severity levels, deliberately.** STRUCTURAL problems (missing key / extra key / empty value) fail **always**, any mode — these are real breakage, a missing key shows the wrong language. UNTRANSLATED (value byte-identical to `en.json`, not in that locale's allowlist) is always *reported* but only *fails* under `--strict`. Default mode stays green while a catalog is mid-translation (`hu.json` was bifurcated from English at the start of the Hungarian work and stayed structurally-parity-but-untranslated for most of it) — an always-red gate teaches everyone to ignore it. `--strict` is the phase-exit / final-verification gate; ran clean (0 untranslated) at ship time.
- **Per-locale allowlist, not one shared list**: `messages/.identical-ok.json` has `allow` (universal — units, document/institution codes, file formats, placeholders, proper nouns: identical in ANY language) and `byLocale.<code>` (locale-specific exemptions). A naturalized loanword is a claim about ONE language, not all of them — Romanian keeps `Total`/`Status` unmodified but Hungarian needs `Összesen`/`Státusz`; `PIN` is `PIN-kód` in Hungarian, not a bare loanword. Effective allowance for a locale is `allow ∪ byLocale[locale]`. **Rule for future translators: adding a key here is a claim it's not a word in that language — verify against `byLocale`, don't reach for the universal `allow` list to silence the gate.**
- Companion gate `scripts/check-i18n-interpolation.mjs` compiles the real `interpolate.ts` (via `tsc` to a temp dir) and calls it with known inputs — a catalog-text scanner can't prove anything about interpolation, since the same `{label}` string is correct both before and after a bug fix in `interpolate()` itself; the fix has to live in the function, and the test has to call the function.

---

## Realtime

### RealtimeProvider (`src/lib/realtime.tsx`)

Subscribes to a single Supabase channel `db-changes` with 7 postgres_changes listeners:

| Table | Invalidated Query Key |
|---|---|
| `trips` | `queryKeys.trips.all` (+ `queryKeys.tripRequests.all` — an aux row's stage joins the live trip, so a trip change mutates the aux read model too) |
| `trip_requests` | `queryKeys.tripRequests.all` + `.detail(id)`. Added so the "Curse" intake strip surfaces a new portal request without an F5 (previously this table was never in the channel at all). Fail-safe: if it isn't in the `supabase_realtime` publication, this is an inert no-op — the ledger still self-heals via `refetchOnWindowFocus` (60s staleTime) and mutation-success invalidation |
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
- `LangToggle` (`src/components/shared/LangToggle.tsx`) -- three-way language switch (`SUPPORTED_LOCALES`-driven) for unauthenticated public pages; see "i18n" above
- `StatusBadge` (`src/components/shared/StatusBadge.tsx`) -- colored pill for trip/assignment/harvest status
- `DataTable` (`src/components/shared/DataTable.tsx`) -- generic table with sorting
- `DocumentViewer` (`src/components/shared/DocumentViewer.tsx`) -- PDF/image preview. Document-type label resolved via `` t(`documents.types.${doc.documentType}`) `` (all seven `DocumentType` values, including `cmr_scan` and `comanda`) — replaced a hardcoded English `typeLabels: Record<DocumentType, string>` map
- `LoggingErrorBoundary` (`src/components/shared/LoggingErrorBoundary.tsx`) -- React error boundary that logs to `clientLogger`
- `SearchInput` (`src/components/shared/SearchInput.tsx`) -- debounced search field
- `SignatureDisplay` (`src/components/shared/SignatureDisplay.tsx`) -- renders base64 signature images
- `UserAvatar` (`src/components/shared/UserAvatar.tsx`) -- avatar tile for `{ fullName, avatarUrl }`. `hideFallback` renders nothing (not a default/initials tile) when there is no real uploaded photo — used on the available-machine cards so an operator with no photo shows no avatar at all rather than a placeholder
- `UserPresenceDot` (`src/components/shared/UserPresenceDot.tsx`) -- green/grey dot indicator based on `user.lastSeenAt` within a shared default window, `DEFAULT_ONLINE_WINDOW_MS = 180_000` (raised from 90 s) -- covers the relaxed mobile heartbeat (jittered ~60-65 s JS interval, deduped against a 60 s native alarm) with room for one missed tick before the dot flips grey. Callers override via `thresholdMs` (e.g. Machines / Available-truck lists pass 15 min for GPS-based presence). Tooltip localized via `useI18n()` (Plan C, H-8 fix)
- `TripTimeline` (`src/components/shared/TripTimeline.tsx`) -- visual timeline of trip state transitions
- `MachineCard` / `ParcelCard` -- compact card views for machines and parcels
- `ExportButton` (`src/components/shared/ExportButton.tsx`, `e275b3c`) -- the single `analytics.export` gate for every data-export trigger in the app (see Reports section above for the full story); renders `null` when the feature is off instead of a disabled button

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
