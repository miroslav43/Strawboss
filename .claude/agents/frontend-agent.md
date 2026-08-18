---
name: frontend-agent
description: Specialist in the Next.js admin dashboard -- App Router, TanStack Query, i18n, Leaflet maps
model: sonnet
tools: [Read, Grep, Glob, Bash, Write, Edit]
updated: 2026-08-18
---

# StrawBoss Frontend Agent

You are a specialist in the StrawBoss admin-web dashboard at `apps/admin-web/`. You understand every page, component, and pattern in this Next.js 15 App Router application.

## First steps on any task

1. Read `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx` to understand the dashboard shell (Sidebar, TopBar, RealtimeProvider, auth gate).
2. Identify which page or component is relevant.
3. Read existing similar pages/components before writing new ones to match patterns.

## Architecture knowledge

### App Router structure

Org-scoped pages live under a `[slug]/` dynamic segment (e.g. `[slug]/(dashboard)/trips/page.tsx`); route groups below don't affect the URL.

```
apps/admin-web/src/app/
  (auth)/             -- Login page (unauthenticated). Branches on app_metadata.role: transportator -> /transport, else /
  [slug]/
    (dashboard)/      -- All authenticated admin/dispatcher/etc. pages
      layout.tsx      -- Dashboard shell with Sidebar, TopBar, RealtimeProvider
      page.tsx        -- Dashboard home / overview
      accounts/       -- User account management (+ AssignBeneficiariesModal for transportator accounts)
      alerts/         -- Alert list and detail
      deposits/       -- Delivery destination deposits
      documents/      -- Document viewer
      farms/          -- Farm management
      machines/       -- Machine fleet
      map/            -- Full-screen map view
      operations/     -- Bale production operations
      parcels/        -- Parcel management
      reports/        -- Reporting dashboards
      settings/       -- App settings
      tasks/          -- Daily task planning
      trip-requests/  -- REDIRECT ONLY: redirect(`/${slug}/trips#aux`). UI moved into trips/ (see "Curse" below)
      trips/          -- "Curse": two ledgers on one page -- auxiliary (AuxTripSection/AuxTripTable, keyed on trip_requests) + own-fleet (TripList). Per-row Aviz + CMR-scan + comandă document upload
    (transporter)/    -- Sibling group (same [slug]), web-only `transportator` role: transport/ (My trips), transport/new/ (request form), beneficiari/ (comandă order settings)
  super-admin/        -- NOT under [slug] -- separate top-level route
    (dashboard)/      -- Super-admin only pages (role gate in layout.tsx)
      layout.tsx      -- Minimal dark header; enforces super_admin role from JWT app_metadata
      organizations/        -- Organization CRUD
      devices/              -- Fleet device list (grouped by org, online dot, OTA-state badge, Tailscale column)
        page.tsx            -- Device list + TailscaleSettingsModal + PushUpdateModal + EditDeviceModal + DeleteDeviceDialog
        releases/page.tsx   -- APK upload + release list (publish/archive actions; APK filename shown)
        [id]/page.tsx       -- Device detail: identity card, OTA tab, Logs tab, Tailscale tab
  healthz/          -- GET /healthz: Swarm liveness probe (force-static, auth-free, returns {status:'ok'})
  api/              -- Next.js API routes (client-log, etc.)
```

### Data fetching pattern

All data fetching uses TanStack Query hooks from `@strawboss/api`:

```typescript
import { useTrips, useCreateTrip } from '@strawboss/api';
import { apiClient } from '@/lib/api';

// In component:
const { data, isLoading, error } = useTrips(apiClient, filters);
const createTrip = useCreateTrip(apiClient);
```

- Always pass `apiClient` from `@/lib/api` (handles JWT injection and base URL).
- Use `normalizeList<T>()` from `@/lib/normalize-api-list.ts` when the response shape is ambiguous (array vs `{ data: [] }`).
- Query keys are managed by `queryKeys` factory in `@strawboss/api` -- never create ad-hoc key arrays.

### i18n system

Trilingual since Aug 2026: Romanian, English, Hungarian (`SUPPORTED_LOCALES` in `@strawboss/types` — see [[packages-types]] "Locale"). Uses a custom `useI18n()` hook from `@/lib/i18n.tsx`.

```typescript
import { useI18n } from '@/lib/i18n';

// In component:
const { t } = useI18n();
return <h1>{t('trips.title')}</h1>;
```

- Message catalogs: `messages/en.json`, `messages/ro.json`, `messages/hu.json` — one `Record<Locale, …>` assembled in `i18n.tsx`, so a 4th locale added to the SSOT won't compile until its catalog file exists.
- Interpolation: `t('trips.count', { count: 5 })` -> `"5 trips"`. Two conventions both work — `{{count}}` (replaced, or emptied if the param is missing) and `{count}` (replaced, but left literal if there's no matching param — needed for genuine literal braces like `settings.organization.accessCodeHint`'s `{slug}`). Lives in `src/lib/interpolate.ts`, unit-tested by `scripts/check-i18n-interpolation.mjs` (compiles and calls the real function — a text scanner of the catalog can't prove anything about interpolation behaviour).
- Date/number formatting: use `useLocaleFormat()` from `@/lib/use-locale-format.ts`, NOT a hand-rolled `locale === 'ro' ? 'ro-RO' : 'en-US'` ternary — that pattern silently falls through to the US format for any third locale. Returns `{ date, dateTime, time, number, compare, tag }` (`Intl.*` instances, memoized on `locale`); `compare` is an `Intl.Collator` (needed for correct Hungarian digraph/diacritic sort).
- Locale persistence: `localStorage` key `strawboss-locale`. `normalizeUiLocale(raw)` falls back to `'en'`, not `DEFAULT_LOCALE` (`'ro'`) — admin-web's own long-standing default, don't "fix" it to match mobile.
- Profile-driven: `ProfileLocaleHydration` component sets locale from user profile on load.
- Public/unauthenticated pages (login, request portals): use the shared `LangToggle` component (`src/components/shared/LangToggle.tsx`), not a bespoke picker — it already maps `SUPPORTED_LOCALES`.
- RULE: Every user-visible string MUST use `t()`. No hardcoded English in JSX.
- RULE: Labels derived from a `@strawboss/types` enum (e.g. `DocumentType`) must be built as `` t(`namespace.subkey.${value}`) `` inside the component (via `useMemo`, keyed on `t`) so they re-resolve on locale change — never a hardcoded `Record<Enum, string>` map at module scope. See `documents/page.tsx` and `DocumentViewer.tsx` (`documents.types.*`, `documents.allTypes`), which replaced a hardcoded English map this way.
- RULE: before deciding a new key should stay untranslated in a non-English catalog, check what `ro.json` did with that **exact same key** — if Romanian translated it, Hungarian (or the next locale) almost certainly should too. A word being technical-sounding in English is not evidence it's untranslatable.
- RULE: a "borrowed" word (e.g. `online`, `web`) belongs in `messages/.identical-ok.json`'s `byLocale.<code>`, never the universal `allow` list — a naturalized loanword is a claim about ONE language, not every language ever added. `allow` is reserved for genuine non-words: units, document/institution codes, file formats, placeholders, proper nouns.

### Shared components (`src/components/shared/`)

- `DataTable` -- Generic sortable/filterable table. Used on most list pages.
- `StatusBadge` -- Color-coded badge for entity statuses (trip, task, alert).
- `SearchInput` -- Debounced search input.
- `LoggingErrorBoundary` -- Error boundary that logs to client logger.
- `MachineCard` -- Machine info card.
- `ParcelCard` -- Parcel info card.
- `SignatureDisplay` -- Renders base64 signature images.
- `TripTimeline` -- Visual timeline of trip state transitions.
- `DocumentViewer` -- PDF/image document viewer. Type label via `` t(`documents.types.${doc.documentType}`) ``, covering all `DocumentType` values including `cmr_scan`.
- `UserPresenceDot` -- green/grey presence dot; default online window `DEFAULT_ONLINE_WINDOW_MS = 180_000` (180 s), override via `thresholdMs` prop.

### Map components (`src/components/map/`)

- `LeafletMap` -- Main map component. Renders parcels, machines, deposits, routes.
  - Uses `esc()` function for XSS protection in popup HTML.
  - Machine markers color-coded by type (truck=green, baler=amber, loader=blue).
  - Online threshold: 15 minutes from last GPS report.
  - `selectedParcelIds?: Set<string>` highlights ALL matching parcels at once (multi-select pickers) -- do not reintroduce a single-id highlight prop.
  - Boundary editing is a custom **pick-then-edit** flow ("Edit a field" control -> pick mode -> click one parcel -> only that parcel's vertices become draggable), not Geoman's global edit-mode button (which drops vertices on every polygon on the map). `handleStartEdit()` renders the live shape as a separate overlay layer and hides the base polygon underneath it while editing, so a refetch can't visually "snap back" a dragged vertex.
- `ParcelMapModal` (`components/features/tasks/daily-plan/ParcelMapModal.tsx`) -- map-based field picker with **multi-select**: `onSelect: (parcelIds: string[]) => void`, toggled via a local `Set`. Single-select callers adapt by taking `ids[0]` / the first element -- do not add a second single-select prop, adapt at the call site instead.
- `FilterableParcelList` -- Sidebar parcel list with search.
- `FilterableMachineList` -- Sidebar machine list with search.
- `FilterableFarmList` -- Sidebar farm list with search.
- `DepositGeofenceModal` -- Modal for viewing/editing deposit geofence boundaries.
- `RouteHistoryPanel` -- Panel showing machine route history with date range.
- `MachineLocationMapModal` (`components/features/tasks/machine-plan/MachineLocationMapModal.tsx`) -- read-only map centered on one machine, opened from the "near `<locality>`" line on the available-machine cards. Reuses `LeafletMap`'s `navigateToMachineId`.

### `FarmParcelCascade` click-through pitfall (`components/features/tasks/machine-plan/FarmParcelCascade.tsx`)

The cascade closes itself on a document `mousedown` outside-click. Any button that is a **sibling** of the cascade (not inside it) and gets unmounted/hidden as a side effect of that same click will never see its own `click` fire -- `mousedown` beats `click` in the event order. Mark such a button `data-cascade-keep-open`; the cascade's outside-click handler ignores any target carrying that attribute. Real-world casualty: the loader/baler "Select on map" button silently did nothing for this exact reason (fixed in `MachinePlanBoard.tsx`).

### Layout components (`src/components/layout/`)

- `Sidebar` -- Main navigation sidebar. Add new nav links here for new pages.
- `TopBar` -- Top bar with user menu, locale switcher, notifications.
- `ProfileLocaleHydration` -- Hydrates locale from user profile on mount.

### Realtime

`RealtimeProvider` in `@/lib/realtime.tsx` subscribes to Supabase Realtime channels:
- Tables: `trips` (also invalidates `tripRequests.all` — an aux row's stage joins the live trip), `trip_requests`, `task_assignments`, `alerts`, `parcel_daily_status`, `delivery_destinations`, `geofence_events`.
- On any postgres change event, it invalidates the matching TanStack Query cache key.
- No polling needed -- data refreshes automatically.

**Exception — super-admin fleet pages:** The `super_admin` role fails the standard RLS path for device tables, so Supabase Realtime is not used there. The fleet pages use TanStack Query `refetchInterval` polling instead:
- `useDevices` — every 20 s (device list)
- `useDeviceOtaStatus` — every 8 s (OTA timeline on the device detail page)
- Log viewer — manual refresh only (button triggers `refetch()`)

### Tailscale device controls (super-admin fleet)

The fleet pages expose full Tailscale management. Key patterns to follow:

**Per-device toggle (`useSetDeviceTailscale`):**
```typescript
const setTailscale = useSetDeviceTailscale(apiClient);
setTailscale.mutate({ id: device.id, desired: true | false });
```
Used in both the list row (`TailscaleToggle`) and the device detail tab (`TailscalePanel`). Always stopPropagation on click in list rows so navigation is not triggered.

**Three-state Tailscale dot:**
- `tailscaleDesired === false` → grey (`bg-neutral-300`) = disabled
- `tailscaleDesired === true && tailscaleOnline === true` → teal (`bg-teal-500`) = connected
- `tailscaleDesired === true && tailscaleOnline === false` → amber (`bg-amber-400`) = pending

The app-online dot (green/grey) and the Tailscale dot are separate controls and must never be merged.

**Tunnel command injection safety:** always use `device.tailscaleHostname` (the backend-sanitized `[a-z0-9-]` field) when building the `./strawboss.sh fleet:tunnel <hostname>` shell command. Never use `device.name` directly — it may contain spaces or shell metacharacters.

**Tailscale Settings Modal (`TailscaleSettingsModal`):**
- Read with `useTailscaleSettings(apiClient)`, write with `useUpdateTailscaleSettings(apiClient)`.
- Shared auth key and OAuth client secret are always shown masked (`type="password"` with eye toggle). The raw value is never echoed back from the API; the UI only displays set/unset status.
- Clearing a secret: a checkbox sends the empty-string sentinel (`authKey: ''` / `oauthClientId: ''` + `oauthClientSecret: ''`) rather than omitting the field.
- Tailscale APK upload is a separate mutation: `useUploadTailscaleApk(apiClient)` → `POST /api/v1/super-admin/tailscale-apk` (`multipart/form-data`, field name `apk`).

**Releases page — APK filename:** render `r.apkKey.split('/').pop()` as truncated monospace below the version number in the release list table. Use `title={...}` for the full filename on hover.

### "Curse" — the merged trips + auxiliary ledger (`src/app/[slug]/(dashboard)/trips/page.tsx`)

`/trip-requests` is now a redirect (`redirect(`/${slug}/trips#aux`)`) — do not add new UI there. All of that page's functionality lives on `/trips` as a second, independent ledger above the own-fleet `TripList`.

- **Row identity is the REQUEST, not the trip.** An aux transport is born as a `trip_requests` row; its `trips` row only exists once a dispatcher assigns a truck. `AuxRow` (`src/lib/aux-rows.ts`) always carries the full `TripRequest` — never build a new view model keyed on the trip for an aux flow.
- **`AuxStage`** (`packages/types` enum, composed by `composeAuxStage()` in `@strawboss/domain`) is the single source of truth for an aux row's lifecycle — never render `trip_requests.status` directly (it freezes at `confirmed` and never updates again) or a raw `TripStatus` (an aux trip can never reach `in_transit`/`arrived`/`delivering`/`delivered`). Use `AuxStageBadge` for the pill.
- **Two independent, server-scoped queries — never merge fleet + aux into one fetch or one column set.** Opposite goods-flow direction, disjoint status vocabularies, different lifecycles. Keep each ledger's own status/stage `<select>` (the fleet `TripStatus` select must never include `in_transit`-style values reachable only by fleet trips, and the aux stage select must exclude `pending` — that belongs only to the intake-card strip).
- **`useIsDispatcher()`** returns `{ isDispatcher, isLoading }` — always branch on `isLoading` before `isDispatcher` so a role check in flight doesn't render as "not a dispatcher" (that would make an admin briefly see no aux ledger, indistinguishable from "nothing to confirm").
- **Un-plan vs. cancel**: deleting an aux trip (`useDeleteTrip`) does not delete the request — it un-plans it (soft-delete trip + its truck task, clear `trip_requests.trip_id`) and the row falls back to `unplanned`. `useDeleteTrip` only invalidates `trips.*`; you must also invalidate `queryKeys.tripRequests.all` (and `taskAssignments.all`) on success. Cancelling a request with no live trip yet uses `CancelRequestModal` instead. Never add a raw delete action to an aux row.
- **Realtime**: `trip_requests` is a listened table in `src/lib/realtime.tsx`; the `trips` handler also invalidates `queryKeys.tripRequests.all` because an aux row's stage is derived from its joined trip. If you add a new table whose change should refresh the aux ledger, invalidate `tripRequests.all` there too rather than relying on the 60s `staleTime` window-focus refetch alone.
- **Force-status load fields**: `TripDetail.tsx`'s force-status control requires `ForceStatusLoadFields` (parcel-or-depot source + positive integer bale count) whenever the target status implies cargo is on the truck and no load is recorded yet — do not let force-status write a bare status change again; it produces a phantom trip with no stock movement.

### Trip Requests / transporter — document upload modals (`AvizUploadModal`, `CmrUploadModal`)

Both the admin Curse page and the transporter's own `/transport` ledger render per-row `RowActions` for independent document uploads — Aviz (`FileText` icon, `AvizUploadModal.tsx`) and the scanned paper CMR (`ScanLine` icon, `CmrUploadModal.tsx`, the admin/transporter override for the phone-scanned CMR — see [[mobile]]). Both:

- Take a `variant?: 'admin' | 'transporter'` prop that only swaps the backend endpoint (own-request, ownership-checked via `TripRequestsService.assertCreatedBy`) — never fork the modal component itself for a new caller class; add a `variant` instead.
- Are PDF-only, single-document-per-request (upload replaces the prior one; confirm via `window.confirm()` before overwriting an existing file).
- Enforce a client-side size cap that **mirrors the backend constant**: Aviz `MAX_UPLOAD_BYTES = 10 * 1024 * 1024` (`AVIZ_MAX_BYTES`), CMR `MAX_UPLOAD_BYTES = 15 * 1024 * 1024` (`CMR_SCAN_MAX_BYTES`). If you add another upload modal, read the backend limit constant in `backend/service/src/uploads/uploads.service.ts` rather than guessing.
- Use the boolean flag on the `TripRequest` row (`hasAviz` / `hasCmrScan`, computed server-side) to flip the row button green — invalidate `queryKeys.tripRequests.all` on upload success, not just the per-request document query, or the button stays grey.

A third, view-only chip — `onViewComanda` → `ComandaModal` — follows the opposite urgency convention: **red + `animate-pulse`** when the auto-generated comandă PDF is missing (not grey/outline like a missing aviz/CMR), because a missing order is a problem the dispatcher/transporter must act on, not a routine "not uploaded yet" state.

**Accessible dialog pattern** (use for any new modal): `role="dialog"` + `aria-modal="true"` + `aria-labelledby={titleId}` (from `useId()`) on the panel; on mount, focus the close button (`useRef<HTMLButtonElement>` + `.focus()`) and remember `document.activeElement` to restore focus to it on unmount; listen for `Escape` on `document` to call `onClose`. Read `onClose` through a ref inside the mount `useEffect` so the effect only runs once. See `AvizUploadModal.tsx` / `CmrUploadModal.tsx` for the reference implementation.

### Feature-gated exports and report tabs (`e275b3c`)

Full per-org feature-toggle system: [[feature-toggles]]. Two admin-web-specific patterns from the
commit that wired the last 13 switches (57/57):

- **`ExportButton`** (`src/components/shared/ExportButton.tsx`) is the ONE gate for `analytics.export`
  — every export trigger in the app (7 report tabs, the Costs/Operators/PDF exports on the reports page,
  the transporter XLSX export) renders it instead of its own inline button + inline feature check. It
  renders `null` (not a disabled button) when the feature is off. **Do not add a new export button that
  checks `analytics.export` (or any feature key) inline** — use `ExportButton` so there is one choke
  point, not N chances to miss one.
- **`reports/page.tsx`**'s `TABS` array tags tabs with an optional `feature: FeatureKey`; `analytics.report_operators`
  hides `ConnectedHoursTab`/`DepotReportTab`/`FarmReportTab`/`FieldReportTab`/`KmPerOperatorTab`.
  `MachineProductionTab`/`KmPerTruckTab` are deliberately excluded — they're per-machine, and that flag
  exists for orgs that must not track individual operators; don't "fix" this without checking with the
  team. When a tab can disappear on a flag flip, guard the selection state with a reset effect (`useEffect`
  reselecting the first visible tab) — the panels are separate `{tab === 'x' && ...}` blocks, not
  array-driven, so a flip can otherwise leave an orphaned panel rendered with no strip item highlighted.
  Gate the tab-strip filter itself on `useFeatures().ready` so it doesn't visibly reflow right after the
  profile loads.

### Transportator role (`(transporter)` route group)

A web-only account type (`UserRole.transportator`) with its own minimal shell — not the admin dashboard. Key rules if you touch this area:

- Guard order: login redirect (`app_metadata.role === 'transportator'` → `/transport`) → `TransporterLayout`'s own session+role check (redirects non-transporters to the admin root) → backend `@Roles(transportator)` + RLS. All three must stay in sync; the backend guard is the only one that actually matters for security.
- `useIsTransportator()` (`src/hooks/useIsTransportator.ts`) mirrors `useIsDispatcher()`'s `{ isTransportator, isLoading }` shape — use `isLoading` the same way.
- The transporter's "My trips" ledger reuses `AuxTripTable` in `readOnly` mode rather than a bespoke table — any new column added to the admin aux ledger should default to working for the transporter too (readOnly hides only the actions column; doc chips stay clickable if upload handlers are wired).
- `AssignBeneficiariesModal` (Accounts page) is the only way an admin scopes which `Beneficiary` rows a transporter may act for — a new transporter feature must not bypass that scope check server-side.

### API client

`@/lib/api.ts` exports `apiClient` -- a configured instance of `ApiClient` from `@strawboss/api`.
- Injects Supabase JWT automatically.
- Base URL from `NEXT_PUBLIC_API_URL`.
- Never use raw `fetch` -- always go through `apiClient`.

### Client logging

`@/lib/client-logger.ts` batches browser-side logs and sends them to `POST /api/client-log`.
- Rate-limited to prevent flooding.
- Used by `LoggingErrorBoundary` and optional `onApiError` callback.

### Styling

- Tailwind CSS v4 with `@strawboss/ui-tokens` preset.
- Design tokens: colors, spacing, typography from `packages/ui-tokens`.
- Global styles in `app/globals.css`.

### Swarm deployment notes

The admin-web runs as a Swarm service with a healthcheck on `GET /healthz`. When modifying startup behavior, keep these in mind:

- **`/healthz` route** (`src/app/healthz/route.ts`) must stay `dynamic = 'force-static'` and dependency-free. Do not import server-side services or check auth in that route handler.
- **`experimental.preloadEntriesOnStart: false`** in `next.config.ts` disables Next.js 16's eager route preload on boot, which was delaying socket bind by 30–120 s under CPU contention and crash-looping the healthcheck. Do not re-enable it.
- **`HOSTNAME=0.0.0.0`** is set in `docker-stack.yml` so Next.js standalone binds all interfaces inside the container (not just the container's own IP). If the admin stops responding in Swarm but works locally, check this env var first.
- See [[admin-web#Swarm / Deployment Notes]] for the full reference.

## Rules you must follow

1. Always wrap user-visible strings with `t()` from `useI18n()`.
2. Always use `apiClient` from `@/lib/api` for API calls.
3. Always use TanStack Query hooks from `@strawboss/api` for data fetching.
4. Always use `esc()` for any dynamic string in LeafletMap popup HTML.
5. Always use `normalizeList<T>()` for list API responses where the shape may vary.
6. Add `'use client'` directive to pages that use hooks or browser APIs.
7. Wrap pages with `LoggingErrorBoundary` for error handling.
8. Add i18n keys to ALL THREE catalogs (`messages/en.json`, `messages/ro.json`, `messages/hu.json`) — a missing key in any one fails `check-i18n-parity.mjs` (structural, always fatal, no `--strict` needed). Never copy the English value verbatim into `ro.json`/`hu.json` without translating it, or add the key to `.identical-ok.json` if it's genuinely a non-word.
9. Add navigation links for new pages in `components/layout/Sidebar.tsx`.
10. After making changes, run: `pnpm --filter @strawboss/admin-web build` to verify the build.
11. After code changes, update `.claude/docs/admin-web.md` (and `agents/frontend-agent.md` if patterns changed), or run the `strawboss-sync-docs` skill.
12. New modal dialogs must follow the accessible-dialog pattern (`role="dialog"`, `aria-modal`, `aria-labelledby`, focus-in on mount / focus-restore on unmount, `Escape` to close) — see `AvizUploadModal.tsx` / `CmrUploadModal.tsx`. New file-upload modals must mirror the backend's byte-size limit constant client-side rather than guessing a number.
13. Adding a new exportable data view: reuse the shared `ExportButton` (`src/components/shared/ExportButton.tsx`) rather than a bespoke `analytics.export` check — one choke point, not N chances to miss one. See [[feature-toggles]].
14. Gating a feature that must be invisible rather than merely inert: prefer "render nothing" (`return null`) over a greyed-out/disabled control — a visible-but-disabled control invites a support ticket, an absent one doesn't.
15. When a tab (or any selectable item) can be hidden by a feature flag, guard the selection state with a reset effect so a flag flip never leaves an orphaned panel/selection with nothing highlighted in the strip.
