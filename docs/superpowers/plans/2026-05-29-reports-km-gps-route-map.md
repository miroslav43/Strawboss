# Per-day GPS route map in the Km report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Reports → "Km per camion", clicking a (truck, day) cell opens an inline map showing that day's GPS route (polyline) for that truck.

**Architecture:** Frontend-only. Reuse the existing `GET /api/v1/location/machines/:id/route` endpoint via the `useRouteHistory` hook. A new self-contained `RouteMiniMap` component renders one route's polyline (extracted from `LeafletMap`'s proven route-drawing pattern). `KmPerTruckTab` gets clickable day cells + an inline route panel. No backend, DB, or `@strawboss/types` changes.

**Tech Stack:** Next.js 15 (App Router) client component, React 19, Leaflet 1.9 (dynamic client-only import), TanStack Query (`useRouteHistory`), Tailwind v4, JSON message catalogs (`messages/{en,ro}.json`).

---

## Verification approach (read first)

`apps/admin-web` has **no unit-test framework** (no vitest/jest/testing-library — confirmed in `package.json`). Following project conventions (YAGNI — do not introduce one), the verification gates for every task are:

- `pnpm --filter @strawboss/admin-web typecheck`
- `pnpm --filter @strawboss/admin-web lint`
- `pnpm --filter @strawboss/admin-web i18n:parity`
- `pnpm --filter @strawboss/admin-web build` (final gate)
- Manual verification checklist (Task 4)

Work happens on branch `feat/reports-km-gps-route-map` (already created, spec already committed).

## File structure

- **Create** `apps/admin-web/src/components/map/RouteMiniMap.tsx` — read-only single-route Leaflet map. One responsibility: draw a polyline + start/end markers for a given `RoutePoint[]`.
- **Modify** `apps/admin-web/messages/en.json` and `apps/admin-web/messages/ro.json` — 7 new keys under `reports.kmPerTruck`.
- **Modify** `apps/admin-web/src/components/features/reports/KmPerTruckTab.tsx` — clickable day cells + inline route panel state and rendering.

Reused as-is (no edits): `useRouteHistory` (`packages/api/src/hooks/use-route-history.ts`), `RoutePoint`/`RouteHistoryResponse` types, `leaflet.routeStart`/`leaflet.routeEnd` message keys, `cn` (`@/lib/utils`).

---

## Task 1: Add i18n keys

**Files:**
- Modify: `apps/admin-web/messages/en.json` (object `reports.kmPerTruck`)
- Modify: `apps/admin-web/messages/ro.json` (object `reports.kmPerTruck`)

- [ ] **Step 1: Replace the `reports.kmPerTruck` block in `en.json`**

Find the existing block and replace it with (adds 7 keys after `colMachine`; note the comma added after the `colMachine` line):

```json
    "kmPerTruck": {
      "title": "Kilometres travelled per truck per day",
      "selectMachines": "Select trucks",
      "allTrucks": "All trucks",
      "noMachines": "No trucks in this organization.",
      "totalKm": "{{km}} km",
      "export": "Export CSV",
      "empty": "No GPS data in the selected range.",
      "colMachine": "Machine",
      "routeTitle": "Show the day's route",
      "routeClose": "Close route",
      "routeLoading": "Loading route…",
      "routeError": "Failed to load route.",
      "routeEmpty": "No GPS points for this day.",
      "routeSinglePoint": "Only one GPS point — no route to draw.",
      "routePoints": "{{n}} GPS points"
    },
```

> Match the existing indentation in the file (the block above uses 4-space indent for the key and 6-space for its members, matching the current `en.json` nesting under `reports`). If the surrounding indentation differs, keep the file's existing style — only the 7 new lines + the comma after `colMachine` are the change.

- [ ] **Step 2: Replace the `reports.kmPerTruck` block in `ro.json`**

```json
    "kmPerTruck": {
      "title": "Kilometri parcurși per camion pe zi",
      "selectMachines": "Selectează camioane",
      "allTrucks": "Toate camioanele",
      "noMachines": "Nu există camioane în organizație.",
      "totalKm": "{{km}} km",
      "export": "Export CSV",
      "empty": "Nu există date GPS în intervalul selectat.",
      "colMachine": "Mașină",
      "routeTitle": "Arată traseul zilei",
      "routeClose": "Închide traseul",
      "routeLoading": "Se încarcă traseul…",
      "routeError": "Eroare la încărcarea traseului.",
      "routeEmpty": "Niciun punct GPS pentru această zi.",
      "routeSinglePoint": "Un singur punct GPS — nu există traseu de afișat.",
      "routePoints": "{{n}} puncte GPS"
    },
```

- [ ] **Step 3: Verify i18n parity (en/ro have identical key sets)**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web i18n:parity`
Expected: success / no missing-key report (exit 0).

- [ ] **Step 4: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/messages/en.json apps/admin-web/messages/ro.json
git commit -m "i18n(reports): add km route-panel keys (en/ro)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Create `RouteMiniMap` component

**Files:**
- Create: `apps/admin-web/src/components/map/RouteMiniMap.tsx`

- [ ] **Step 1: Write the component**

Create `apps/admin-web/src/components/map/RouteMiniMap.tsx` with exactly:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoutePoint } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

// Default map center: Deta, Timiș (matches LeafletMap).
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 13;

interface RouteMiniMapProps {
  /** Route points in chronological order. */
  points: RoutePoint[];
  className?: string;
}

/**
 * Read-only Leaflet map that draws a single GPS route polyline with start/end
 * markers. Self-contained: no parcels, machines, draw tools, or geoman — unlike
 * the full `LeafletMap`. Used by the Km-per-truck report to show a day's route.
 *
 * Leaflet is dynamically imported (client-only). Only `polyline` /
 * `circleMarker` are used, so the `L.Icon.Default` image setup is unnecessary.
 */
export function RouteMiniMap({ points, className }: RouteMiniMapProps) {
  const { t } = useI18n();
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // ── 1. Initialise map (client-only dynamic import) ──────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');

      if (!isMounted || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoom: DEFAULT_ZOOM, center: DETA_CENTER });

      // Recalculate container size after the dynamic import lays out the box.
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView(DETA_CENTER, DEFAULT_ZOOM);
      });

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, IGN',
        },
      ).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true);
    };

    void init();

    return () => {
      isMounted = false;
      setMapReady(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // ── 2. Re-measure when the container box changes ────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    const el = mapRef.current;
    if (!map || !mapReady || !el) return;

    let raf = 0;
    const scheduleInvalidate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    scheduleInvalidate();

    const ro = new ResizeObserver(() => scheduleInvalidate());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mapReady]);

  // ── 3. Draw the route polyline whenever points change ───────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (!points || points.length < 2) return;

    const render = async () => {
      const L = (await import('leaflet')).default;
      const latLngs = points.map((p) => [p.lat, p.lon] as [number, number]);

      const polyline = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.8,
        dashArray: '8 4',
      });

      const startMarker = L.circleMarker(latLngs[0], {
        radius: 6,
        color: '#16a34a',
        fillColor: '#16a34a',
        fillOpacity: 1,
      }).bindTooltip(t('leaflet.routeStart'), { permanent: false });

      const endMarker = L.circleMarker(latLngs[latLngs.length - 1], {
        radius: 6,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 1,
      }).bindTooltip(t('leaflet.routeEnd'), { permanent: false });

      const group = L.layerGroup([polyline, startMarker, endMarker]).addTo(map);
      routeLayerRef.current = group;
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    };

    void render();
  }, [points, mapReady, t]);

  return <div ref={mapRef} className={className ?? 'h-full w-full'} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Lint**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web lint`
Expected: PASS (no errors; the two `eslint-disable` lines suppress the `any` ref warnings, matching `LeafletMap`).

- [ ] **Step 4: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src/components/map/RouteMiniMap.tsx
git commit -m "feat(admin-web): add RouteMiniMap — single-route read-only Leaflet map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire clickable cells + inline route panel into `KmPerTruckTab`

**Files:**
- Modify: `apps/admin-web/src/components/features/reports/KmPerTruckTab.tsx`

- [ ] **Step 1: Update imports**

Replace the top import block (lines 1-10) with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, MapPin, X } from 'lucide-react';
import { useMachines, useTruckDistanceReport, useRouteHistory } from '@strawboss/api';
import type { Machine, MachineType, PaginatedResponse, TruckDistanceRow } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { KmPerTruckChart, type KmChartRow } from './KmPerTruckChart';
import { RouteMiniMap } from '@/components/map/RouteMiniMap';
```

- [ ] **Step 2: Add route-selection state + derived query**

Immediately after the `orderedMachineIds` declaration (currently line 99,
`const orderedMachineIds = cappedSelected.filter((id) => byMachine.has(id));`),
add:

```tsx
  // Inline route panel: which (truck, day) cell is open.
  const [selected, setSelected] = useState<{
    machineId: string;
    machineCode: string;
    date: string;
    km: number;
  } | null>(null);

  // Close the panel if its truck is no longer in the filtered set.
  useEffect(() => {
    if (selected && !byMachine.has(selected.machineId)) {
      setSelected(null);
    }
  }, [selected, byMachine]);

  // The /route endpoint takes a timestamp window; bucket the selected UTC day.
  const routeFrom = selected ? `${selected.date}T00:00:00.000Z` : '';
  const routeTo = selected ? `${selected.date}T23:59:59.999Z` : '';
  const routeQuery = useRouteHistory(apiClient, selected?.machineId ?? null, routeFrom, routeTo);
  const routePoints = routeQuery.data?.points ?? [];
  const routeTotalPoints = routeQuery.data?.totalPoints ?? 0;
```

- [ ] **Step 3: Make day cells clickable in the table body**

In the table body, the current row mapping builds `kmByDate` and renders cells.
Replace the block from `const kmByDate = new Map<string, number>();` through the
closing of the day-cell `.map(...)` (currently lines 258-271) with:

```tsx
                  // Build date→km and date→pointCount maps for fast lookup
                  // across the chart's ordered date columns (missing days = 0).
                  const kmByDate = new Map<string, number>();
                  const pointByDate = new Map<string, number>();
                  for (const r of rows) {
                    kmByDate.set(r.date, r.distanceKm);
                    pointByDate.set(r.date, r.pointCount);
                  }
                  const totalKm = rows.reduce((s, r) => s + r.distanceKm, 0);
                  return (
                    <tr key={machineId} className="hover:bg-neutral-50/60">
                      <td className="px-4 py-2 font-medium text-neutral-800">{code}</td>
                      {chartRows.map((cr) => {
                        const km = kmByDate.get(cr.date) ?? 0;
                        const pc = pointByDate.get(cr.date) ?? 0;
                        const isActive =
                          selected?.machineId === machineId && selected?.date === cr.date;
                        if (pc > 0) {
                          return (
                            <td key={cr.date} className="px-3 py-2 text-right text-sm tabular-nums">
                              <button
                                type="button"
                                title={t('reports.kmPerTruck.routeTitle')}
                                onClick={() =>
                                  setSelected((prev) =>
                                    prev && prev.machineId === machineId && prev.date === cr.date
                                      ? null
                                      : { machineId, machineCode: code, date: cr.date, km },
                                  )
                                }
                                className={cn(
                                  'rounded px-1.5 py-0.5 transition-colors hover:bg-blue-50 hover:text-blue-700',
                                  isActive
                                    ? 'bg-blue-100 font-semibold text-blue-700'
                                    : 'text-neutral-700',
                                )}
                              >
                                {km.toFixed(2)}
                              </button>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={cr.date}
                            className="px-3 py-2 text-right text-sm tabular-nums text-neutral-400"
                          >
                            {km.toFixed(2)}
                          </td>
                        );
                      })}
```

> Note: the original code computed `totalKm` *after* the cell `.map`. The block
> above moves the `totalKm` line *above* the `return` and removes the old
> standalone `const totalKm = ...` line. The trailing `<td>` total cell and the
> `</tr>` that follow (current lines 272-276) stay unchanged:
>
> ```tsx
>                       <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-800">
>                         {t('reports.kmPerTruck.totalKm', { km: totalKm.toFixed(2) })}
>                       </td>
>                     </tr>
> ```

- [ ] **Step 4: Add the inline route panel after the table**

The table lives inside `<div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white"> … </div>` (currently closes at line 280), which is the last child of the `<> … </>` fragment. Immediately after that closing `</div>` and before the fragment's closing `</>`, insert:

```tsx
          {selected && (
            <div className="rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-blue-500" />
                  <span className="font-semibold text-neutral-800">{selected.machineCode}</span>
                  <span className="text-neutral-400">·</span>
                  <span className="text-neutral-600">{selected.date}</span>
                  <span className="text-neutral-400">·</span>
                  <span className="font-medium text-neutral-700">
                    {t('reports.kmPerTruck.totalKm', { km: selected.km.toFixed(2) })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={t('reports.kmPerTruck.routeClose')}
                  className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 py-2 text-xs text-neutral-500">
                {routeQuery.isLoading
                  ? t('reports.kmPerTruck.routeLoading')
                  : routeQuery.isError
                    ? t('reports.kmPerTruck.routeError')
                    : routeTotalPoints === 0
                      ? t('reports.kmPerTruck.routeEmpty')
                      : routeTotalPoints === 1
                        ? t('reports.kmPerTruck.routeSinglePoint')
                        : t('reports.kmPerTruck.routePoints', { n: routeTotalPoints })}
              </div>
              {!routeQuery.isLoading && !routeQuery.isError && routePoints.length >= 2 && (
                <div className="h-96 w-full overflow-hidden rounded-b-xl">
                  <RouteMiniMap points={routePoints} className="h-full w-full" />
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 5: Typecheck**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web typecheck`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src/components/features/reports/KmPerTruckTab.tsx
git commit -m "feat(admin-web): click a Km cell to show that day's GPS route inline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full admin-web build**

Run: `cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web build`
Expected: build succeeds (no type/lint errors break the build).

> If the build fails because shared packages aren't built in this branch, run
> `./strawboss.sh build packages` first, then re-run the build.

- [ ] **Step 2: Manual verification (dev server)**

Run: `./strawboss.sh dev` (admin on `localhost:3000`), log in as an admin, go to
**Reports → Km per camion**, select a truck with recent GPS data, set a date
range that includes active days, then verify:

- [ ] A day cell with km > 0 is a **clickable button**; a 0.00 cell is greyed and not clickable.
- [ ] Clicking a cell opens the inline panel under the table with header `cod · YYYY-MM-DD · {km} km` and a map.
- [ ] The map draws the route polyline with a green start dot and a red end dot, fitted to bounds.
- [ ] Clicking the **same** cell again closes the panel; clicking a **different** cell switches the route.
- [ ] The close (X) button closes the panel.
- [ ] De-selecting the open truck's chip closes the panel.
- [ ] A day that has exactly one GPS point shows the `routeSinglePoint` notice and no map.
- [ ] Switching the UI language to English shows the English strings (`routeTitle`, etc.).

- [ ] **Step 3: Update the design spec's single-point note (consistency)**

The spec said a single point shows "marker + notice". The implementation shows
notice-only (no map) for simplicity. In
`docs/superpowers/specs/2026-05-29-reports-km-gps-route-map-design.md`, edit the
single-point edge case to: "`totalPoints === 1` → show the `routeSinglePoint`
notice, no map." Commit:

```bash
cd /srv/apps/Strawboss
git add docs/superpowers/specs/2026-05-29-reports-km-gps-route-map-design.md
git commit -m "docs(reports): spec — single-point day shows notice only

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** RouteMiniMap (Task 2) ✓; clickable cells + state + inline panel + edge cases (Task 3) ✓; i18n keys (Task 1) ✓; close-on-deselect, single-point, empty, loading, error all handled in Task 3 Step 4 ✓; print stays `print:hidden` via the parent page (no change needed) ✓.
- **No placeholders:** every code step shows full content; verification commands have expected outcomes.
- **Type consistency:** `selected` shape `{ machineId, machineCode, date, km }` is used identically in Steps 2-4; `useRouteHistory(apiClient, machineId|null, from, to)` matches `packages/api/src/hooks/use-route-history.ts`; `RoutePoint[]` flows from `routeQuery.data.points` → `RouteMiniMap.points`; tooltips use `leaflet.routeStart`/`leaflet.routeEnd` (verified to exist).
