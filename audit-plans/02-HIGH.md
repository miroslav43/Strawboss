# 🟠 HIGH — 10 tasks

> Part of the StrawBoss audit. See [`README.md`](./README.md) for full context, root causes (R1–R6), and the C5 keystore decision.
> Build order for shared-package edits: `types → validation → ui-tokens → domain → api → backend/admin-web`. Typecheck after each task: `./strawboss.sh typecheck all` (you run the UI build).

**Theme:** brute-force surface, a trip-forking authz hole, stored XSS, the snake_case data breakage on 4 live pages, a fleet-plugin shadowing bug, and delta-sync starvation. **H7 is the root of H4–H6 — do it first.**

---

## H1 · Throttle the public portal code endpoints
- **Files:** `backend/service/src/trip-requests/public-portal.controller.ts:36–54`; reuse `PinThrottleGuard`/`PinThrottleService`
- **Steps:** add `@UseGuards(PinThrottleGuard)` to `verify` and `requests`; key throttle on `slug` + IP (the guard already reads XFF — fix the IP source per M4). Optionally lengthen the code and add a per-slug lockout after N failures.
- **Acceptance:** >N wrong codes → 429; legitimate verify still works.

## H2 · Restrict `next-iteration` and guard `createNextIteration`
- **Files:** `backend/service/src/trips/trips.controller.ts:253–262`; `trips/trips.service.ts:1793–1922`
- **Steps:** (1) drop `loader_operator` from the route's `@Roles` (leave `admin`), **or** route it through the same ownership+idempotent path as `loaderRecallResponse`. (2) Inside `createNextIteration`, require the source trip `status === 'completed'` (or `getAvailableTransitions`-style validation) before minting an iteration and stamping `recall_decision`.
- **Acceptance:** a loader can't fork a `planned`/`in_transit` trip on a truck they don't operate; admin manual override still works on completed trips.

## H3 · Remove the duplicate Boot* native-file generation
- **Files:** `apps/mobile/plugins/withDeviceOwner.js:1244–1319,1459–1497,1541–1542`; `apps/mobile/plugins/withAlwaysOnTracking.js:207–208`
- **Steps:** delete the `BOOT_RECEIVER_KT`/`BOOT_REARM_SERVICE_KT` constants + manifest-push + `writeFileSync` from `withDeviceOwner.js` (the shadowed copy). Fold any genuinely-wanted improvement (e.g. `android:priority=999`, native pre-start of `PresenceService`) into the single canonical `withAlwaysOnTracking.js` implementation. Add a comment guarding against reintroducing a second definition.
- **Acceptance:** exactly one BootReceiver/BootRearmService source is generated; prebuild is deterministic; on-device boot-recovery soak test passes.

## H7 · Fix the `useTrips` type/shape mismatch (root of H4–H6)
- **Files:** `packages/api/src/hooks/use-trips.ts:22`; backend `trips/trips.service.ts` `list()` ~269–291; `apps/admin-web/src/lib/trip-mapper.ts` (`toTripCamel`)
- **Steps:** choose one and apply consistently — **(a)** alias every trip column to camelCase in `TripsService.list()` (like `DeliveryDestinationsService`/`ReportsService` already do) and drop ad-hoc mappers; **or (b)** type the hook's generic as a raw snake_case row and route all list consumers through `toTripCamel()` (add `toTripCamelList()`). Prefer (a) for a single source of truth. Rebuild `@strawboss/api`.
- **Acceptance:** consumers reading `tripNumber`/`destinationName`/`baleCount`/`createdAt` get real values.

## H4 · Command Center live feed
- **Files:** `apps/admin-web/src/app/[slug]/(dashboard)/command-center/page.tsx:88,131`
- **Steps:** after H7, map rows through `toTripCamel()` (or rely on the aliased backend). **Acceptance:** source/destination/bale-count/trip-number render for active trips.

## H5 · Machine detail chart + trips table
- **Files:** `apps/admin-web/src/app/[slug]/(dashboard)/machines/[machineId]/page.tsx:86,143,346,354–356`
- **Steps:** map through `toTripCamel()`; `createdAt` now populates the 7-day bucket. **Acceptance:** activity chart shows real bars; table columns populated.

## H6 · Dashboard "Recent Trips" widget
- **Files:** `apps/admin-web/src/components/features/dashboard/RecentTrips.tsx:35,39`; `.../(dashboard)/page.tsx:58,64`
- **Steps:** map rows before render. **Acceptance:** trip number + destination display.

## H8 · Fix stored XSS — permanent machine tooltip
- **Files:** `apps/admin-web/src/app/[slug]/(dashboard)/machines/[machineId]/MiniMap.tsx:56`
- **Steps (R4):** escape `label` with the existing `esc()` helper from `LeafletMap.tsx` (extract it to a shared util), **or** pass a text `Node` (`document.createTextNode(label)`) to `bindTooltip` so Leaflet appends instead of `innerHTML`.
- **Acceptance:** a machine `internalCode` of `<img src=x onerror=alert(1)>` renders literally, no script.

## H9 · Fix stored XSS — hover track tooltip
- **Files:** `apps/admin-web/src/components/tracks/TracksMap.tsx:173–187`
- **Steps:** same as H8 for `r.label`. **Acceptance:** payload in `internalCode`/`make`/`model` is inert on hover.

## H10 · Generalize delta-sync skew protection beyond `trips`
- **Files:** `backend/service/src/sync/sync.service.ts:719–731`; `apps/mobile/src/sync/SyncManager.ts:191–254`
- **Steps:** pick one — (a) apply the trips "force-include recently-active rows regardless of cursor" pattern to `task_assignments` (today's) and the other syncable tables' operationally-critical rows; **or** (b) make `sync_version` monotonic with commit order via `pg_advisory_xact_lock` in the assigning trigger; **or** (c) reprocess a small version/time window with client-side dedup.
- **Acceptance:** a low-versioned `task_assignments` row committing after a higher one is still delivered to the device.

---

## Verification (High tier)
- Brute-force `/public/portal/:slug/verify` with wrong codes → 429 after the cap.
- Loader account → `POST /trips/:id/next-iteration` on a non-completed trip they don't operate → rejected.
- Command-center / dashboard / machine-detail render real trip number, destination, bale count, and a populated 7-day chart.
- Machine `internalCode = <img src=x onerror=alert(1)>` → inert on both maps.
- `prebuild` generates exactly one BootReceiver/BootRearmService.
- `./strawboss.sh typecheck all` green.
