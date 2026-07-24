# Loader "Trucks at Loader" card — assignment-aware redesign

**Date:** 2026-07-24
**Scope:** Mobile (`apps/mobile`) loader-operator home screen + one new backend endpoint. **No DB migration.**
**Status:** Design approved by product owner (pending written-spec review).

---

## 1. Problem

On the loader-operator home tab (`apps/mobile/app/(loader)/index.tsx`), the "trucks at loader"
card lists **every org truck within 75 m of the loader machine** (pure GPS proximity via
`ST_DWithin`, 15-min window). Trip assignment is used only to paint the green/amber
"loaded / ready-to-load" badge — it never filters the list.

Consequence: a truck that is physically near the loader but belongs to a *different* loader
still appears. The operator cannot tell which trucks are actually theirs, and the card carries
no context about the assigned job (which field, which trip).

The product owner wants the card to be organized around **assigned work** (trips whose loader is
this machine, plus the field being loaded), with GPS proximity demoted to a *presence indicator*
("here now" vs "on the way"), and unassigned-but-nearby trucks kept visible only as a
de-emphasized secondary group.

## 2. Key data facts (verified)

- **`trips.loader_id` (loader MACHINE) is dependable** on essentially every real trip. Both real
  creation paths guarantee it: the task-assignment materialization path won't create a trip until
  a parent loader task exists (`trips.service.ts` `autoUpsertFromTruckTask`), and the loader
  register-load self-create writes `dto.loaderMachineId`. Auxiliary trips always set it too.
- **`trips.loader_operator_id` (loader USER) is NOT reliable** — genuinely nullable on
  dispatcher-planned own-fleet trips. **We must key the assignment filter on `loader_id`, not
  `loader_operator_id`.**
- The mobile loader app already knows its `assignedMachineId` (the loader machine) from the auth
  store — this is what `useTrucksAtLoader` already passes to the backend.
- The origin field for a trip is `trips.source_parcel_id` (enriched label `sourceParcelName`).
- Existing building blocks (reused, not reinvented):
  - `getTrucksAtLoader` proximity SQL — `backend/service/src/location/location.service.ts:445`.
  - Aux-trip-by-loader filter `listAuxiliaryForLoader` (`WHERE is_auxiliary AND loader_id = …`) —
    `trips.service.ts:1509`.
  - `useMyTrucksToLoad` (`GET /trips?loaderOperatorId=…`) — keyed on the *unreliable* operator id,
    used only on the "Încărcări" tab; **not reused** here for that reason.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Card organization | Assigned trucks on top; unassigned-nearby in a dimmed, collapsible secondary group. |
| Unassigned nearby trucks | Kept visible (dimmed, tagged "neasignat") — not hidden. Handles walk-ups. |
| Assignment key | `trips.loader_id = <my loader machine>` (NOT `loader_operator_id`). |
| Active statuses shown | `planned`, `loading`, `loaded`. |
| Truck already `loaded` | Stays on card, dimmed, sorted to the bottom, badge "✓ Încărcat", until it departs (status advances past `loaded`). |
| Auxiliary trucks | Merged into the single assigned list with an "auxiliar" tag (no presence badge — they usually have no GPS). The separate aux section on the home screen is removed. |
| Backend shape | One new endpoint returning both groups in a single response (one poll per 15 s). |
| DB migration | None. |

## 4. Backend design

### 4.1 New endpoint

```
GET /api/v1/location/loader-board/:loaderMachineId?radiusM=75&windowMinutes=15
@Roles('admin', 'loader_operator')
```

Lives in the **location** module (`location.controller.ts` / `location.service.ts`), alongside and
reusing `getTrucksAtLoader`. Defaults match the existing endpoint (`radiusM=75`, `windowMinutes=15`).
Org-scoped exactly like `getTrucksAtLoader`.

### 4.2 Response shape

```ts
interface LoaderBoardResponse {
  assigned: AssignedTruck[];        // trips.loader_id === loaderMachineId, active status
  nearbyUnassigned: TruckAtLoader[]; // within radius, NOT in `assigned` (existing shape, reused)
}

interface AssignedTruck {
  tripId: string;
  truckId: string;                  // machine id (used by goToLoad)
  registrationPlate: string | null;
  internalCode: string | null;
  driverName: string | null;        // null for auxiliary trips
  sourceParcelName: string | null;      // the field being loaded ("Sola 4")
  sourceParcelMunicipality: string | null;
  tripStatus: 'planned' | 'loading' | 'loaded';
  isAuxiliary: boolean;
  presence: 'here' | 'enroute' | 'loaded' | 'unknown';
  distanceM: number | null;         // distance truck→loader when a recent GPS ping exists
  lastSeenAt: string | null;        // ISO, latest truck ping within window
  loadState: 'loaded' | 'empty';    // kept for badge parity with today
}
```

### 4.3 Query logic

1. **Loader position** — latest `machine_location_events` ping for `loaderMachineId` within
   `windowMinutes` (same CTE as `getTrucksAtLoader`). May be NULL if the loader phone hasn't
   pinged recently — the assigned list must still render (presence degrades, see below).
2. **`assigned`** — `SELECT` from `trips t` where
   `t.loader_id = :loaderMachineId AND t.deleted_at IS NULL AND t.status IN ('planned','loading','loaded')`,
   joined to `machines` (truck plate/internal code), `users` (driver name via `t.driver_id`),
   `parcels` (source field via `t.source_parcel_id`), and a `LEFT JOIN LATERAL` to the truck's
   latest GPS ping within `windowMinutes`. Distinct by truck (latest trip wins if a truck somehow
   has two active trips). Includes auxiliary trips (`is_auxiliary = true`) naturally — they match
   `loader_id`.
3. **Presence** per assigned truck:
   - `tripStatus = 'loaded'` → `'loaded'`.
   - else has recent GPS ping AND `ST_DWithin(truck, loader, radiusM)` → `'here'` (`distanceM` set).
   - else has recent GPS ping (outside radius) → `'enroute'` (`distanceM` = real distance, may be km).
   - else (no recent ping, or loader position NULL so distance is uncomputable) → `'unknown'`.
4. **`nearbyUnassigned`** — the existing `getTrucksAtLoader` proximity result, **minus** any truck
   whose `truckId` already appears in `assigned` (assigned wins; no truck appears twice).

Implementation note: reuse `getTrucksAtLoader` verbatim for the proximity set, then compute the
set difference in the service, and run the `assigned` query separately. Two queries, one endpoint,
one client poll.

## 5. Mobile design

### 5.1 Data layer

- Add `LoaderBoardResponse` / `AssignedTruck` types and a typed fetch in **`@strawboss/api`**
  (mirror `packages/api/src/hooks/use-trucks-at-loader.ts`).
- New hook `useLoaderBoard()` in `apps/mobile/src/hooks/` — reads `assignedMachineId` from the auth
  store, polls `GET /location/loader-board/:id` every 15 s (same cadence/gating as the current
  `useTrucksAtLoader`). It **replaces** `useTrucksAtLoader` on the home screen.
- `useAuxiliaryTrips` is **removed from the home screen** (its trucks now arrive via the board's
  `assigned` array). Verify during implementation that the old aux section had no extra behavior
  beyond listing (e.g. a request/link action); if it did, preserve that action on the merged rows.

### 5.2 Screen (`apps/mobile/app/(loader)/index.tsx`)

Replace the single proximity section with:

- **Section "Camioane de încărcat (N)"** — from `board.assigned`, sorted
  `here → enroute → loaded`; within a bucket, ascending `distanceM` (nulls last). One
  `AssignedTruckCard` per item:
  - line 1: plate (`registrationPlate ?? internalCode ?? fallback`) + driver name (omit if null).
  - line 2: field — "Câmp: {sourceParcelName}" (omit if null).
  - right: presence badge — `● Aici acum {Xm}` / `○ Pe drum {dist}` / `✓ Încărcat`; `loaded` rows
    rendered dimmed. Auxiliary rows carry an extra small "auxiliar" tag and no presence badge
    (presence `unknown` for aux with no GPS renders as a neutral "asignat" state).
  - tap → `goToLoad(truckId)` (unchanged route `/loader-ops/load-bales?truckId=…`).
- **Section "Alte camioane în zonă"** — from `board.nearbyUnassigned`, reusing the current
  `TruckCard` look but visually de-emphasized (reduced opacity / muted container) and each row
  tagged "neasignat". Collapsible; the whole section is hidden when the array is empty. Tap still
  routes to `goToLoad` (a walk-up can be loaded).
- Empty/edge states:
  - No `assignedMachineId` → existing `EmptyCard` ("no machine assigned").
  - `assigned` empty but `nearbyUnassigned` non-empty → show only the dimmed section, plus a small
    "niciun camion asignat azi" hint in the assigned section.
  - Both empty → existing "no trucks" `EmptyCard`.

### 5.3 i18n

New/updated keys under `loader.home.*` in **every** locale file the app ships (RO + EN at minimum;
match whatever `apps/mobile` currently carries): section titles (assigned / nearby-unassigned),
badges (`badgeHereNow`, `badgeEnroute`, `badgeLoaded`), `tagAuxiliary`, `tagUnassigned`, field
prefix, and the "no trucks assigned today" hint. No hardcoded strings.

## 6. Non-goals (explicit scope boundary)

- No change to the register-load / "Camion plin" flow.
- No change to the "Încărcări" (`bales.tsx`) tab or `useMyTrucksToLoad`.
- No web/dispatcher changes — assignment already happens via task assignments.
- No DB migration, no schema change.
- Offline: the card keeps today's network-first behavior (shows last successful result; empty when
  never fetched). Reading the assigned list from local SQLite for offline resilience is a possible
  future enhancement, explicitly out of scope here.

## 7. Edge cases

- Loader phone GPS stale (loader position NULL): assigned list still renders; presence falls back
  to `enroute`/`unknown` without distance; `nearbyUnassigned` is empty (proximity uncomputable).
- Assigned truck with no recent GPS (e.g. aux, or phone offline): presence `unknown`, shown as
  "asignat / pe drum" without distance — never dropped.
- A truck both assigned and within radius: appears once, in `assigned` only (deduped by `truckId`).
- Truck advances past `loaded` (departed): drops off the board (status no longer in the active set).

## 8. Verification

- `./strawboss.sh typecheck backend`, `typecheck api`, `typecheck admin-web` (as affected), and
  the mobile package typecheck. (Product owner runs the mobile UI build himself.)
- Manual: as a loader operator with an assigned trip, confirm the assigned truck shows with the
  correct field and a live presence badge; confirm an unassigned nearby truck lands in the dimmed
  group; confirm a loaded truck stays dimmed at the bottom; confirm an auxiliary trip shows with
  the "auxiliar" tag.

## 9. Affected files (anticipated)

- `backend/service/src/location/location.controller.ts` — new route.
- `backend/service/src/location/location.service.ts` — new `getLoaderBoard`, reusing
  `getTrucksAtLoader`.
- `packages/api/src/hooks/` — new board types + typed fetch (mirror `use-trucks-at-loader.ts`).
- `apps/mobile/src/hooks/useLoaderBoard.ts` — new hook.
- `apps/mobile/app/(loader)/index.tsx` — card rewrite (assigned + dimmed sections; remove aux
  section import).
- Mobile i18n locale files — new `loader.home.*` keys.
