# Assignment-Aware Loader Trucks Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the loader-operator home "trucks at loader" card so it is organized around the trucks *assigned* to this loader (with a here/on-the-way/loaded presence badge and the field being loaded), keeping merely-nearby unassigned trucks in a dimmed secondary group.

**Architecture:** A new backend endpoint `GET /api/v1/location/loader-board/:loaderMachineId` returns `{ assigned, nearbyUnassigned }`. `assigned` = non-auxiliary trips whose `loader_id` is this loader machine (status planned/loading/loaded), each enriched with GPS-derived presence. `nearbyUnassigned` = the existing proximity result minus the assigned trucks. The mobile screen renders assigned trucks (new `AssignedTruckCard`) + auxiliary trucks (existing `AuxTruckCard`, merged at the UI layer) in one "to load" section, and the dimmed nearby group below.

**Tech Stack:** NestJS 11 + Fastify, Drizzle `sql` tagged template over postgres.js/PostGIS (backend); `@strawboss/api` shared types; Expo/React Native + TanStack Query + Expo Router (mobile); i18n via `@/lib/i18n` (`ro.ts` / `en.ts`).

## Global Constraints

- **Assignment key is `trips.loader_id` (loader MACHINE), NEVER `loader_operator_id`** — the operator column is nullable on dispatcher-planned trips.
- **Active statuses shown:** `planned`, `loading`, `loaded` (exact SQL literals).
- **No DB migration, no schema change.**
- **Verification gate = typecheck + manual.** There is NO jest/test harness in this repo (`backend/service` has no jest config and no `*.spec.ts`; `apps/mobile` has no test runner). Do NOT invent a test framework. Each task's gate is `./strawboss.sh typecheck <target>` (which runs `pnpm --filter "@strawboss/<target>" typecheck`) plus a concrete manual check. Typecheck targets used here: `backend`, `api`, `mobile`. ⚠️ A wrong target name makes `strawboss.sh` silently print "All typechecks passed" — use exactly these three.
- **i18n:** every new user-facing string is a `loader.home.*` key added to BOTH `apps/mobile/src/i18n/ro.ts` and `apps/mobile/src/i18n/en.ts`. No hardcoded strings.
- **Non-goals (do NOT touch):** the register-load / "Camion plin" flow, the "Încărcări" tab (`apps/mobile/app/(loader)/bales.tsx`), `useMyTrucksToLoad`, admin-web, `useAuxiliaryTrips`' data contract.

### Design note — auxiliary trucks (deviation from spec §3/§4, resolved)

The spec proposed folding auxiliary trips into `board.assigned`. Implementation resolves this **at the UI layer instead**: `board.assigned` returns only **non-auxiliary** trips (`t.is_auxiliary = false`), and the existing `useAuxiliaryTrips` hook + `AuxTruckCard` + `goToAuxLoad` are reused unchanged, rendered *inside* the same "Camioane de încărcat" section. Rationale: `goToAuxLoad` passes `auxTripId` + `isAuxiliary` (needed for the offline CMR scan, per the in-code warning) and `AuxTruckCard` shows crop/bale-count/quality — data the board's `AssignedTruck` shape does not carry. The purple **AUX** badge already tags them, so the visual outcome ("one coherent list, aux tagged") is unchanged. Auxiliary trucks have no GPS device, so they do not appear in `nearbyUnassigned`.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/api/src/hooks/use-trucks-at-loader.ts` | Modify | Add `AssignedTruck` + `LoaderBoardResponse` interfaces (co-located with `TruckAtLoader`, which `nearbyUnassigned` reuses). |
| `packages/api/src/hooks/index.ts` | Modify | Re-export the two new types. |
| `backend/service/src/location/location.service.ts` | Modify | Add `getLoaderBoard()` — reuses `getTrucksAtLoader()` for proximity, adds the assigned-trips query + presence + set difference. |
| `backend/service/src/location/location.controller.ts` | Modify | Add `GET loader-board/:loaderMachineId` route (mirror of `getTrucksAtLoader`). |
| `apps/mobile/src/hooks/useLoaderBoard.ts` | Create | Mobile hook: polls the new endpoint every 15s (mirror of `useTrucksAtLoader`). |
| `apps/mobile/src/i18n/ro.ts` | Modify | New `loader.home.*` keys (RO). |
| `apps/mobile/src/i18n/en.ts` | Modify | New `loader.home.*` keys (EN). |
| `apps/mobile/app/(loader)/index.tsx` | Modify | Screen rewrite: `AssignedTruckCard`, UI-merge aux, dimmed nearby group, new styles. |

---

## Task 1: `@strawboss/api` board types

**Files:**
- Modify: `packages/api/src/hooks/use-trucks-at-loader.ts`
- Modify: `packages/api/src/hooks/index.ts:19-20`

**Interfaces:**
- Consumes: existing `TruckAtLoader` (same file).
- Produces: `AssignedTruck`, `LoaderBoardResponse` — imported by the backend contract (by convention) and by `useLoaderBoard` (Task 4).

- [ ] **Step 1: Append the two interfaces to `use-trucks-at-loader.ts`** (after the existing `TruckAtLoader` interface, before the `useTrucksAtLoader` function, i.e. after line 18)

```ts
export interface AssignedTruck {
  tripId: string;
  truckId: string;
  registrationPlate: string | null;
  internalCode: string | null;
  driverName: string | null;
  sourceParcelName: string | null;
  sourceParcelMunicipality: string | null;
  tripStatus: 'planned' | 'loading' | 'loaded';
  isAuxiliary: boolean;
  /** 'here' = within radius; 'enroute' = has GPS but outside radius; 'loaded' = load done; 'unknown' = no recent GPS. */
  presence: 'here' | 'enroute' | 'loaded' | 'unknown';
  /** Truck→loader distance when a recent GPS ping exists; null otherwise. */
  distanceM: number | null;
  lastSeenAt: string | null;
  /** 'loaded' once the trip is loaded; 'empty' while planned/loading. */
  loadState: 'loaded' | 'empty';
}

export interface LoaderBoardResponse {
  /** Non-auxiliary trucks assigned to this loader machine (trips.loader_id), still to-load. */
  assigned: AssignedTruck[];
  /** Trucks within GPS proximity that are NOT in `assigned`. */
  nearbyUnassigned: TruckAtLoader[];
}
```

- [ ] **Step 2: Add the barrel re-exports** in `packages/api/src/hooks/index.ts` immediately after line 20 (`export type { TruckAtLoader } from './use-trucks-at-loader.js';`)

```ts
export type { AssignedTruck, LoaderBoardResponse } from './use-trucks-at-loader.js';
```

- [ ] **Step 3: Typecheck**

Run: `./strawboss.sh typecheck api`
Expected: `All typechecks passed.` (or the single-target success line). No TS errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/hooks/use-trucks-at-loader.ts packages/api/src/hooks/index.ts
git commit -m "feat(api): loader-board response types (AssignedTruck, LoaderBoardResponse)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend `getLoaderBoard` service method

**Files:**
- Modify: `backend/service/src/location/location.service.ts` (add method after `getTrucksAtLoader`, which ends at line 562)

**Interfaces:**
- Consumes: `this.getTrucksAtLoader(loaderMachineId, { radiusM, windowMinutes }, orgId)` (existing, returns the proximity rows with field `id`), `this.drizzleProvider.db.execute`, `sql` / `sql.raw` from `drizzle-orm`.
- Produces: `getLoaderBoard(loaderMachineId: string, options: { radiusM?: number; windowMinutes?: number }, orgId: string | null): Promise<{ assigned: AssignedTruckRow[]; nearbyUnassigned: <getTrucksAtLoader row>[] }>` — consumed by the controller (Task 3). Field shape matches `AssignedTruck` from Task 1.

- [ ] **Step 1: Add the method** directly below `getTrucksAtLoader` (insert after line 562, before the next method). Note: `getTrucksAtLoader` already performs the org-membership check and `windowMinutes` validation, so calling it first covers both.

```ts
  /**
   * The loader's work board (drives the loader home screen).
   *
   *  • `assigned` — NON-auxiliary trips whose loader_id is this machine, still
   *    to-load (planned/loading/loaded), each with a GPS-derived presence
   *    (here / enroute / loaded / unknown). Keyed on loader_id (the MACHINE):
   *    loader_operator_id is nullable on dispatcher-planned trips.
   *  • `nearbyUnassigned` — the proximity result minus the assigned trucks, so
   *    no truck appears twice (assigned wins).
   *
   * Auxiliary trips are intentionally excluded (is_auxiliary = false): the
   * mobile screen renders them from the dedicated auxiliary endpoint so the
   * offline aux-load flow is preserved.
   */
  async getLoaderBoard(
    loaderMachineId: string,
    options: { radiusM?: number; windowMinutes?: number } = {},
    orgId: string | null,
  ): Promise<{
    assigned: Array<{
      tripId: string;
      truckId: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      sourceParcelName: string | null;
      sourceParcelMunicipality: string | null;
      tripStatus: 'planned' | 'loading' | 'loaded';
      isAuxiliary: boolean;
      presence: 'here' | 'enroute' | 'loaded' | 'unknown';
      distanceM: number | null;
      lastSeenAt: string | null;
      loadState: 'loaded' | 'empty';
    }>;
    nearbyUnassigned: Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
      tripStatus: string | null;
      loadState: 'loaded' | 'empty';
    }>;
  }> {
    const radiusM = options.radiusM ?? 75;
    const windowMinutes = options.windowMinutes ?? 15;

    // Proximity set (also validates windowMinutes + loader-in-org membership).
    const nearby = await this.getTrucksAtLoader(loaderMachineId, { radiusM, windowMinutes }, orgId);

    const orgFilter = orgId !== null ? sql`AND t.organization_id = ${orgId}::uuid` : sql``;

    const assignedRows = (await this.drizzleProvider.db.execute(sql`
      WITH loader_pos AS (
        SELECT coords
        FROM machine_location_events
        WHERE machine_id = ${loaderMachineId}::uuid
          AND recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY recorded_at DESC
        LIMIT 1
      ),
      truck_pos AS (
        SELECT DISTINCT ON (mle.machine_id)
          mle.machine_id, mle.coords, mle.recorded_at
        FROM machine_location_events mle
        WHERE mle.recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY mle.machine_id, mle.recorded_at DESC
      )
      SELECT DISTINCT ON (t.truck_id)
        t.id                          AS "tripId",
        t.truck_id                    AS "truckId",
        m.registration_plate          AS "registrationPlate",
        m.internal_code               AS "internalCode",
        u.full_name                   AS "driverName",
        p.name                        AS "sourceParcelName",
        p.municipality                AS "sourceParcelMunicipality",
        t.status                      AS "tripStatus",
        t.is_auxiliary                AS "isAuxiliary",
        CASE
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL
            THEN ROUND(ST_Distance(tp.coords::geography, lp.coords::geography)::numeric, 1)::float
          ELSE NULL
        END                           AS "distanceM",
        tp.recorded_at                AS "lastSeenAt",
        CASE
          WHEN t.status = 'loaded' THEN 'loaded'
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL
               AND ST_DWithin(tp.coords::geography, lp.coords::geography, ${radiusM}) THEN 'here'
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL THEN 'enroute'
          ELSE 'unknown'
        END                           AS "presence",
        CASE WHEN t.status = 'loaded' THEN 'loaded' ELSE 'empty' END AS "loadState"
      FROM trips t
      JOIN machines m           ON m.id = t.truck_id
      LEFT JOIN users u         ON u.id = t.driver_id
      LEFT JOIN parcels p       ON p.id = t.source_parcel_id
      LEFT JOIN truck_pos tp    ON tp.machine_id = t.truck_id
      LEFT JOIN loader_pos lp   ON TRUE
      WHERE t.loader_id = ${loaderMachineId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_auxiliary = false
        AND t.status IN ('planned', 'loading', 'loaded')
        ${orgFilter}
      ORDER BY t.truck_id, t.updated_at DESC
    `)) as unknown as Array<{
      tripId: string;
      truckId: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      sourceParcelName: string | null;
      sourceParcelMunicipality: string | null;
      tripStatus: 'planned' | 'loading' | 'loaded';
      isAuxiliary: boolean;
      presence: 'here' | 'enroute' | 'loaded' | 'unknown';
      distanceM: number | null;
      lastSeenAt: string | null;
      loadState: 'loaded' | 'empty';
    }>;

    const assignedTruckIds = new Set(assignedRows.map((r) => r.truckId));
    const nearbyUnassigned = nearby.filter((truck) => !assignedTruckIds.has(truck.id));

    return { assigned: assignedRows, nearbyUnassigned };
  }
```

- [ ] **Step 2: Typecheck**

Run: `./strawboss.sh typecheck backend`
Expected: success, no TS errors. (Confirms the inline return type + `sql` usage compile.)

- [ ] **Step 3: Commit**

```bash
git add backend/service/src/location/location.service.ts
git commit -m "feat(location): getLoaderBoard — assigned trucks (loader_id) + presence + nearby-unassigned

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend `loader-board` route

**Files:**
- Modify: `backend/service/src/location/location.controller.ts` (add handler after `getTrucksAtLoader`, which ends at line 102)

**Interfaces:**
- Consumes: `this.locationService.getLoaderBoard(...)` (Task 2), `@Roles`, `@Param`, `@Query`, `@CurrentUser`, `UserRole` (all already imported in this file).
- Produces: `GET /api/v1/location/loader-board/:loaderMachineId?radiusM=&windowMinutes=` returning `LoaderBoardResponse`.

- [ ] **Step 1: Add the route handler** directly below `getTrucksAtLoader` (insert after line 102)

```ts
  /**
   * GET /api/v1/location/loader-board/:loaderMachineId
   * Loader/admin-only: the loader's work board — trucks ASSIGNED to this loader
   * (trips.loader_id) with a here/on-the-way/loaded presence badge, plus trucks
   * merely within GPS proximity that are NOT assigned. Scoped to the caller's org.
   * Optional `radiusM` (default 75) and `windowMinutes` (default 15) query params.
   */
  @Get('loader-board/:loaderMachineId')
  @Roles(UserRole.admin, UserRole.loader_operator)
  getLoaderBoard(
    @Param('loaderMachineId') loaderMachineId: string,
    @CurrentUser() user: RequestUser,
    @Query('radiusM') radiusMRaw?: string,
    @Query('windowMinutes') windowMinutesRaw?: string,
  ) {
    const radiusM = radiusMRaw ? Number(radiusMRaw) : undefined;
    const windowMinutes = windowMinutesRaw ? Number(windowMinutesRaw) : undefined;
    return this.locationService.getLoaderBoard(
      loaderMachineId,
      {
        radiusM: Number.isFinite(radiusM) ? radiusM : undefined,
        windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : undefined,
      },
      user.organizationId,
    );
  }
```

- [ ] **Step 2: Typecheck**

Run: `./strawboss.sh typecheck backend`
Expected: success.

- [ ] **Step 3: Manual smoke test** (dev backend)

Start dev if not running: `./strawboss.sh dev` (starts API on `localhost:3001` + Redis). Obtain a loader-operator JWT and that loader's machine id, then:

```bash
curl -s "http://localhost:3001/api/v1/location/loader-board/<LOADER_MACHINE_ID>" \
  -H "Authorization: Bearer <LOADER_JWT>" | jq
```

Expected: HTTP 200 with a body shaped `{ "assigned": [...], "nearbyUnassigned": [...] }`. Each `assigned` item has `tripId`, `truckId`, `presence` ∈ `here|enroute|loaded|unknown`, and `distanceM` (number or null). With no assigned trips today, `assigned` is `[]` and `nearbyUnassigned` mirrors the old `trucks-at-loader` output. A truck present in `assigned` must NOT also appear in `nearbyUnassigned`.

- [ ] **Step 4: Commit**

```bash
git add backend/service/src/location/location.controller.ts
git commit -m "feat(location): GET loader-board/:loaderMachineId route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Mobile `useLoaderBoard` hook

**Files:**
- Create: `apps/mobile/src/hooks/useLoaderBoard.ts`

**Interfaces:**
- Consumes: `useAuthStore((s) => s.assignedMachineId)` from `@/stores/auth-store`, `mobileApiClient.get` from `@/lib/api-client`, `LoaderBoardResponse` from `@strawboss/api` (Task 1).
- Produces: `useLoaderBoard(options?: { loaderMachineId?: string | null; radiusM?: number; windowMinutes?: number; pollMs?: number }): UseQueryResult<LoaderBoardResponse>` — consumed by the screen (Task 6) as `board.data?.assigned` / `board.data?.nearbyUnassigned` / `board.isLoading` / `board.isFetching` / `board.refetch`.

- [ ] **Step 1: Create the file** (mirrors `useTrucksAtLoader.ts` exactly — same auth-store selector, same `mobileApiClient.get`, `enabled` gate, and poll shape; only the endpoint, response type, and queryKey differ)

```ts
import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { LoaderBoardResponse } from '@strawboss/api';

interface Options {
  /** Override the default loader machine id (e.g. for admins). */
  loaderMachineId?: string | null;
  radiusM?: number;
  windowMinutes?: number;
  /** Polling interval in ms (default 15s). */
  pollMs?: number;
}

/**
 * The loader's work board: trucks ASSIGNED to this loader (with a here/on-the-way
 * /loaded presence badge) plus trucks merely within GPS proximity that are not
 * assigned. Polls every 15s by default. Disabled when no machine id is available.
 */
export function useLoaderBoard(options: Options = {}) {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const loaderMachineId = options.loaderMachineId ?? assignedMachineId;

  const params = new URLSearchParams();
  if (options.radiusM != null) params.set('radiusM', String(options.radiusM));
  if (options.windowMinutes != null) params.set('windowMinutes', String(options.windowMinutes));
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery<LoaderBoardResponse>({
    queryKey: ['loader-board', loaderMachineId, options.radiusM, options.windowMinutes],
    queryFn: () =>
      mobileApiClient.get<LoaderBoardResponse>(
        `/api/v1/location/loader-board/${loaderMachineId}${qs}`,
      ),
    enabled: !!loaderMachineId,
    refetchInterval: options.pollMs ?? 15_000,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `./strawboss.sh typecheck mobile`
Expected: success (confirms `LoaderBoardResponse` resolves from `@strawboss/api`).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/useLoaderBoard.ts
git commit -m "feat(mobile): useLoaderBoard hook (polls loader-board endpoint)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: i18n keys (RO + EN)

**Files:**
- Modify: `apps/mobile/src/i18n/ro.ts` (loader `home` block, insert before its closing `},` at line 622)
- Modify: `apps/mobile/src/i18n/en.ts` (loader `home` block, insert before its closing `},` — the block mirrors RO, starting at line 594)

**Interfaces:**
- Produces: keys `loader.home.sectionAssignedTrucks`, `sectionNearbyUnassigned`, `noAssignedTrucksTitle`, `noAssignedTrucksSubtitle`, `badgeHereNow`, `badgeEnroute`, `badgePresenceLoaded`, `fieldPrefix` (param `{field}`), `tagUnassigned`, `distanceMeters` (param `{distance}`), `distanceKm` (param `{distance}`) — consumed by the screen (Task 6). Interpolation is single-brace `{var}`, matching the existing `truckDistancePrefix: 'la {distance}'`.

- [ ] **Step 1: Add RO keys** in `apps/mobile/src/i18n/ro.ts`, immediately after the `quality2: 'Calitate 2',` line (621) and before the `},` that closes the `home` block (622)

```ts
      // Assignment-aware loader board
      sectionAssignedTrucks: 'Camioane de încărcat',
      sectionNearbyUnassigned: 'Alte camioane în zonă',
      noAssignedTrucksTitle: 'Niciun camion asignat azi',
      noAssignedTrucksSubtitle:
        'Aici apar camioanele pe care dispecerul ți le-a asignat la acest loader.',
      badgeHereNow: '● Aici acum',
      badgeEnroute: '○ Pe drum',
      badgePresenceLoaded: '✓ Încărcat',
      fieldPrefix: 'Câmp: {field}',
      tagUnassigned: 'neasignat',
      distanceMeters: '{distance} m',
      distanceKm: '{distance} km',
```

- [ ] **Step 2: Add EN keys** in `apps/mobile/src/i18n/en.ts`, at the matching spot in the loader `home` block (after its `quality2:` line, before the block's closing `},`)

```ts
      // Assignment-aware loader board
      sectionAssignedTrucks: 'Trucks to load',
      sectionNearbyUnassigned: 'Other trucks nearby',
      noAssignedTrucksTitle: 'No trucks assigned today',
      noAssignedTrucksSubtitle:
        'Trucks the dispatcher assigned to this loader show up here.',
      badgeHereNow: '● Here now',
      badgeEnroute: '○ On the way',
      badgePresenceLoaded: '✓ Loaded',
      fieldPrefix: 'Field: {field}',
      tagUnassigned: 'unassigned',
      distanceMeters: '{distance} m',
      distanceKm: '{distance} km',
```

- [ ] **Step 3: Typecheck**

Run: `./strawboss.sh typecheck mobile`
Expected: success. (If the locale files are typed against a key union, this also confirms RO/EN parity.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/i18n/ro.ts apps/mobile/src/i18n/en.ts
git commit -m "i18n(mobile): loader-board strings (assigned/nearby/presence)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Screen rewrite — `apps/mobile/app/(loader)/index.tsx`

**Files:**
- Modify: `apps/mobile/app/(loader)/index.tsx` (imports; component body 40–197; add `AssignedTruckCard`; extend `TruckCard`; add styles)

**Interfaces:**
- Consumes: `useLoaderBoard` (Task 4), `AssignedTruck` (Task 1), i18n keys (Task 5), existing `useAuxiliaryTrips` / `AuxTruckCard` / `goToAuxLoad` / `goToLoad` / `TruckCard` / `EmptyCard`.
- Produces: the reworked loader home screen (no exported symbols change).

- [ ] **Step 1: Swap the hook import.** In `apps/mobile/app/(loader)/index.tsx`, replace line 21 (`import { useTrucksAtLoader } from '@/hooks/useTrucksAtLoader';`) with:

```ts
import { useLoaderBoard } from '@/hooks/useLoaderBoard';
```

- [ ] **Step 2: Add the `AssignedTruck` type import.** Change line 26 (`import type { TruckAtLoader } from '@strawboss/api';`) to keep `TruckAtLoader` (still used by the nearby group) and add `AssignedTruck`:

```ts
import type { TruckAtLoader, AssignedTruck } from '@strawboss/api';
```

- [ ] **Step 3: Swap the hook call + add derived data.** Replace line 42 (`const trucks = useTrucksAtLoader();`) with the board hook, and add the sorted-assigned / nearby / counts derivations plus the collapse state. Replace line 42 with:

```ts
  const board = useLoaderBoard();
```

Then, immediately after line 45 (`const { modalProps } = useModal();`), add:

```ts
  const [nearbyOpen, setNearbyOpen] = useState(true);

  const presenceRank: Record<AssignedTruck['presence'], number> = {
    here: 0,
    enroute: 1,
    unknown: 1,
    loaded: 2,
  };
  const assigned = [...(board.data?.assigned ?? [])].sort((a, b) => {
    const r = presenceRank[a.presence] - presenceRank[b.presence];
    if (r !== 0) return r;
    return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);
  });
  const nearby = board.data?.nearbyUnassigned ?? [];
  const auxList = auxTrips.data ?? [];
  const toLoadCount = assigned.length + auxList.length;
```

- [ ] **Step 4: Update `onRefresh`.** Replace the body of `onRefresh` (line 53) `await Promise.all([trucks.refetch(), auxTrips.refetch()]);` with:

```ts
    await Promise.all([board.refetch(), auxTrips.refetch()]);
```

Also update its dependency array on line 55 from `[parcel, trucks, auxTrips]` to:

```ts
  }, [parcel, board, auxTrips]);
```

- [ ] **Step 5: Replace the two sections' JSX.** Replace the entire block from line 140 (`<View style={styles.trucksHeader}>`) through line 197 (the closing `) : null}` of the auxiliary section) with the following. This renders ONE "to load" section (assigned + aux), then the dimmed collapsible nearby group.

```tsx
        {/* ─── Camioane de încărcat (asignate + auxiliare) ───────────────── */}
        <View style={styles.trucksHeader}>
          <Text style={styles.sectionTitle}>
            {t('loader.home.sectionAssignedTrucks')}
            {toLoadCount > 0 ? ` (${toLoadCount})` : ''}
          </Text>
          {(board.isFetching && !board.isLoading) ||
          (auxTrips.isFetching && !auxTrips.isLoading) ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </View>

        {!assignedMachineId ? (
          <EmptyCard
            icon="alert-circle-outline"
            title={t('loader.home.noLoaderAssignedTitle')}
            subtitle={t('loader.home.noLoaderAssignedSubtitle')}
          />
        ) : board.isLoading && auxTrips.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>{t('loader.home.searchingTrucks')}</Text>
          </View>
        ) : toLoadCount === 0 ? (
          <EmptyCard
            icon="truck-outline"
            title={t('loader.home.noAssignedTrucksTitle')}
            subtitle={t('loader.home.noAssignedTrucksSubtitle')}
          />
        ) : (
          <>
            {assigned.map((truck) => (
              <AssignedTruckCard
                key={truck.tripId}
                truck={truck}
                onPress={() => goToLoad(truck.truckId)}
                t={t}
              />
            ))}
            {auxList.map((trip) => (
              <AuxTruckCard key={trip.id} trip={trip} onPress={() => goToAuxLoad(trip)} t={t} />
            ))}
          </>
        )}

        {/* ─── Alte camioane în zonă (neasignate, estompate, colapsabile) ── */}
        {assignedMachineId && nearby.length > 0 ? (
          <>
            <TouchableOpacity
              style={styles.trucksHeader}
              activeOpacity={0.7}
              onPress={() => setNearbyOpen((v) => !v)}
            >
              <Text style={styles.sectionTitleMuted}>
                {t('loader.home.sectionNearbyUnassigned')} ({nearby.length})
              </Text>
              <MaterialCommunityIcons
                name={nearbyOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.tertiary}
              />
            </TouchableOpacity>
            {nearbyOpen
              ? nearby.map((truck) => (
                  <View key={truck.id} style={styles.dimmed}>
                    <TruckCard truck={truck} onPress={() => goToLoad(truck.id)} t={t} unassigned />
                  </View>
                ))
              : null}
          </>
        ) : null}
```

- [ ] **Step 6: Extend `TruckCard` with the `unassigned` tag.** In the `TruckCard` function (starts line 207), add the `unassigned` prop and render a "neasignat" tag next to the plate. Replace the prop destructuring + type (lines 207–215) with:

```tsx
function TruckCard({
  truck,
  onPress,
  t,
  unassigned,
}: {
  truck: TruckAtLoader;
  onPress: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  unassigned?: boolean;
}) {
```

Then replace the plate `<Text>` block (lines 227–229) with a row that appends the tag when `unassigned`:

```tsx
          <View style={styles.plateRowInline}>
            <Text style={styles.truckPlate} numberOfLines={1} ellipsizeMode="tail">
              {label}
            </Text>
            {unassigned ? (
              <View style={styles.unassignedTag}>
                <Text style={styles.unassignedTagText}>{t('loader.home.tagUnassigned')}</Text>
              </View>
            ) : null}
          </View>
```

- [ ] **Step 7: Add the `AssignedTruckCard` component.** Insert immediately after the `TruckCard` function (after its closing `}` at line 260, before `EmptyCard`):

```tsx
function AssignedTruckCard({
  truck,
  onPress,
  t,
}: {
  truck: AssignedTruck;
  onPress: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const label =
    truck.registrationPlate ?? truck.internalCode ?? t('loader.home.truckFallbackLabel');
  const isLoaded = truck.presence === 'loaded';

  const distanceText =
    truck.distanceM == null
      ? null
      : truck.distanceM >= 1000
        ? t('loader.home.distanceKm', { distance: (truck.distanceM / 1000).toFixed(1) })
        : t('loader.home.distanceMeters', { distance: Math.round(truck.distanceM) });

  let badgeText: string;
  let badgeStyle: object;
  let badgeTextStyle: object;
  if (truck.presence === 'loaded') {
    badgeText = t('loader.home.badgePresenceLoaded');
    badgeStyle = styles.presenceLoaded;
    badgeTextStyle = styles.presenceLoadedText;
  } else if (truck.presence === 'here') {
    badgeText = distanceText
      ? `${t('loader.home.badgeHereNow')} · ${distanceText}`
      : t('loader.home.badgeHereNow');
    badgeStyle = styles.presenceHere;
    badgeTextStyle = styles.presenceHereText;
  } else {
    // enroute + unknown share the "on the way" badge (unknown = no recent GPS).
    badgeText = distanceText
      ? `${t('loader.home.badgeEnroute')} · ${distanceText}`
      : t('loader.home.badgeEnroute');
    badgeStyle = styles.presenceEnroute;
    badgeTextStyle = styles.presenceEnrouteText;
  }

  return (
    <TouchableOpacity
      style={[styles.truckCard, isLoaded && styles.truckCardLoaded]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.truckRow}>
        <View style={styles.truckIconWrap}>
          <MaterialCommunityIcons name="truck" size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.truckPlate} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
          {truck.driverName ? (
            <Text style={styles.truckMeta} numberOfLines={1} ellipsizeMode="tail">
              {truck.driverName}
            </Text>
          ) : null}
          {truck.sourceParcelName ? (
            <Text style={styles.fieldLine} numberOfLines={1} ellipsizeMode="tail">
              <MaterialCommunityIcons name="map-marker" size={11} color={colors.textSecondary} />{' '}
              {t('loader.home.fieldPrefix', { field: truck.sourceParcelName })}
            </Text>
          ) : null}
        </View>
        <View style={[styles.presenceBadge, badgeStyle]}>
          <Text numberOfLines={1} style={[styles.presenceBadgeText, badgeTextStyle]}>
            {badgeText}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.tertiary} />
      </View>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 8: Add the new styles.** In the `styles = StyleSheet.create({ ... })` block (lines 362–429), add these entries before the closing `});` (line 429). They reuse the existing palette (`#E8F5EE`/`#0A5C36` green, `#FEF3C7`/`#92400E` amber, neutral greys) already used by `loadBadge*`:

```ts
  sectionTitleMuted: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  truckCardLoaded: { opacity: 0.6 },
  dimmed: { opacity: 0.55 },
  fieldLine: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  plateRowInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unassignedTag: {
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  unassignedTagText: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  presenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 132,
  },
  presenceBadgeText: { fontSize: 12, fontWeight: '700' },
  presenceHere: { backgroundColor: '#E8F5EE' },
  presenceHereText: { color: '#0A5C36' },
  presenceEnroute: { backgroundColor: '#FEF3C7' },
  presenceEnrouteText: { color: '#92400E' },
  presenceLoaded: { backgroundColor: '#E5E7EB' },
  presenceLoadedText: { color: '#374151' },
```

- [ ] **Step 9: Typecheck**

Run: `./strawboss.sh typecheck mobile`
Expected: success. In particular, no "`trucks` is not defined" (all references replaced), no unused-import error for `useTrucksAtLoader` (the import was removed in Step 1), and `AssignedTruck['presence']` indexing on `presenceRank` compiles.

- [ ] **Step 10: Manual on-device check** (product owner runs the mobile build)

As a loader operator with at least one assigned trip today:
1. The "Camioane de încărcat (N)" section lists the assigned truck(s) with the field ("Câmp: …") and a presence badge — "● Aici acum · Xm" when the truck's phone is within 75 m of the loader, "○ Pe drum · …" otherwise.
2. A loaded trip shows "✓ Încărcat" and is dimmed.
3. An auxiliary trip still appears (purple AUX badge) and tapping it opens the aux load flow unchanged.
4. A truck physically nearby but NOT assigned appears only under the dimmed, collapsible "Alte camioane în zonă (N)" group with a "neasignat" tag — and never in the top section.
5. Pull-to-refresh updates both groups.

- [ ] **Step 11: Commit**

```bash
git add "apps/mobile/app/(loader)/index.tsx"
git commit -m "feat(mobile): assignment-aware loader trucks card (assigned + presence, dimmed nearby, UI-merged aux)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Endpoint `loader-board` + `@Roles(admin, loader_operator)` + reuse of `getTrucksAtLoader` → Tasks 2, 3. ✅
- Response `{ assigned, nearbyUnassigned }` with exact `AssignedTruck` fields → Task 1 type + Task 2 SQL aliases (names match 1:1). ✅
- Assignment key `trips.loader_id`, statuses planned/loading/loaded, aux included by loader_id but rendered via UI-merge (flagged deviation, non-aux in endpoint) → Task 2 WHERE clause + Design note. ✅
- `nearbyUnassigned` = proximity minus assigned (dedupe by truck id) → Task 2 `assignedTruckIds` filter. ✅
- Presence loaded/here/enroute/unknown; loader-position-NULL still renders assigned (presence→unknown, distance→null) → Task 2 CASE expressions (both `tp.coords`/`lp.coords` NULL-guarded). ✅
- Types in `@strawboss/api`, exported; mobile hook mirrors `useTrucksAtLoader` (auth store, `mobileApiClient`, 15s, `enabled`, queryKey) → Tasks 1, 4. ✅
- Screen: assigned sorted here→enroute→loaded then distance asc nulls-last; row = plate + driver + "Câmp:" + presence badge; aux tag; loaded dimmed; dimmed collapsible nearby group with "neasignat" tag hidden when empty; empty states → Tasks 5, 6. ✅
- i18n both locales, `{var}` interpolation → Task 5. ✅
- Non-goals untouched (register-load, bales.tsx, useMyTrucksToLoad, admin-web, no migration) → nothing in the plan edits them. ✅

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N"; every code step carries full verbatim code. ✅

**Type-name consistency:** `AssignedTruck` field names are identical across the `@strawboss/api` interface (Task 1), the backend inline return type + SQL `AS "…"` aliases (Task 2), and the screen usage (`truck.tripId`, `truck.truckId`, `truck.sourceParcelName`, `truck.presence`, `truck.distanceM`) (Task 6). `presence` union `here|enroute|loaded|unknown` matches in all three. `LoaderBoardResponse.assigned/nearbyUnassigned` names match the hook and screen (`board.data?.assigned` / `board.data?.nearbyUnassigned`). Hook name `useLoaderBoard`, i18n keys `loader.home.*`, and style keys (`presenceHere`, `presenceEnroute`, `presenceLoaded`, `truckCardLoaded`, `dimmed`, `fieldLine`, `sectionTitleMuted`, `plateRowInline`, `unassignedTag`) are referenced exactly as defined. ✅
