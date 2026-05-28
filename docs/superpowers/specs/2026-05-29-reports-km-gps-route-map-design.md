# Design — GPS route map per (truck, day) in the Km report

**Date:** 2026-05-29
**Status:** Approved (Approach A)
**Scope:** `apps/admin-web` only. No backend, DB, or `@strawboss/types` changes.

## Problem

The Reports → "Km per camion" tab (`KmPerTruckTab`) already shows kilometres
travelled per truck per day, computed server-side from the GPS track
(`ST_DistanceSphere` over `machine_location_events`, noise-capped). What it does
**not** show is the actual GPS *line* (polyline) for a given day. The user wants
to see, alongside the per-day km, the route the truck actually drove.

## Decision

Frontend-only feature. The building blocks already exist:

- `GET /api/v1/location/machines/:machineId/route?from=&to=` returns
  `RouteHistoryResponse { points: RoutePoint[], totalPoints, ... }`
  (`location.controller.ts:49`, `location.service.ts` `getRouteHistory`).
- `useRouteHistory(apiClient, machineId, from, to)` hook in `@strawboss/api`
  (already used by `RouteHistoryPanel`).
- `LeafletMap.tsx` already renders a route polyline (section 6, lines ~774-819):
  `L.polyline` + green start `circleMarker` + red end `circleMarker` +
  `fitBounds`. This pattern is extracted into a new lightweight component.

We do **not** reuse `LeafletMap` directly (it requires ~20 props: parcels,
machines, draw callbacks, geoman tooling — all irrelevant here). We do **not**
add a backend endpoint (the existing `/route` endpoint is sufficient for v1).

## Components

### 1. `RouteMiniMap.tsx` (new) — `apps/admin-web/src/components/map/`

Self-contained, read-only Leaflet map that draws a single route.

- **Props:** `{ points: RoutePoint[]; className?: string }`
- Dynamic-imports `leaflet` + `leaflet/dist/leaflet.css` (client-only, same
  pattern as `LeafletMap`).
- Tile layer: Esri World Imagery (same URL as `LeafletMap`, for visual
  consistency).
- Renders:
  - `L.polyline(latLngs, { color:'#3b82f6', weight:3, opacity:0.8, dashArray:'8 4' })`
  - green `circleMarker` at first point (tooltip `map.routeStart`)
  - red `circleMarker` at last point (tooltip `map.routeEnd`)
  - `map.fitBounds(polyline.getBounds(), { padding:[40,40] })`
- Uses only `circleMarker` / `polyline` → **no** `L.Icon.Default` image setup
  needed (unlike `LeafletMap`, which places default markers).
- Cleans up the map instance on unmount (`map.remove()`), and re-renders the
  route layer when `points` changes.
- No layer toggles, no draw tools, no geoman import.

### 2. `KmPerTruckTab.tsx` (modify) — `apps/admin-web/src/components/features/reports/`

- Build a per-machine lookup `Map<date, { km, pointCount }>` from the existing
  `byMachine` grouping (rows already carry `distanceKm` and `pointCount`).
- Render each day cell:
  - if `pointCount > 0` → a `<button>` (clickable, subtle hover/affordance)
  - else → plain text (current behaviour), not clickable.
- New state: `selected: { machineId; machineCode; date; km } | null`.
- Click a cell → set `selected`. Re-click the same cell → toggle closed
  (`selected = null`). Click another cell → replace.
- When `selected != null`, render an inline panel **below the table**:
  - header: `{machineCode} · {date} · {km} km` + close (X) button
  - GPS point count line
  - `useRouteHistory(apiClient, selected.machineId, dayStart, dayEnd)` where
    `dayStart = ${selected.date}T00:00:00.000Z`,
    `dayEnd = ${selected.date}T23:59:59.999Z`
  - states: loading / error / empty (`totalPoints === 0`) / single-point
    (`totalPoints === 1`, no polyline) / map (`<RouteMiniMap points=... />`)
- If the currently-selected truck is removed from the chip selection (so its
  row disappears), close the panel (`selected = null`).

## Data flow

```
click cell (machineId, date)
   → setSelected({ machineId, machineCode, date, km })
   → useRouteHistory(machineId, dayStartISO, dayEndISO)   [existing endpoint]
   → <RouteMiniMap points={data.points} />                → polyline on Leaflet
header km = the table cell's distanceKm (noise-capped server value = source of truth)
```

The polyline is drawn from the **raw** `/route` points (no noise filtering),
while the displayed km is the noise-capped server value. This is intentional and
acceptable for v1; the km number remains authoritative.

## Edge cases

- Cell with `km == 0` / `pointCount == 0` → not clickable (nothing to show).
- `totalPoints === 1` → no polyline possible; show the single marker + a
  "single point" notice (`reports.kmPerTruck.routeSinglePoint`).
- De-selecting the truck whose route is open → close the panel.
- Print: the whole screen tab is already wrapped in `print:hidden`; the map is
  not part of the print layout (acceptable for v1).

## i18n

New keys under `reports.kmPerTruck.*` in both `ro` and `en` locale files:
`routeTitle`, `routeClose`, `routeLoading`, `routeError`, `routeEmpty`,
`routeSinglePoint`, `routePoints` (with `{n}` interpolation). Reuse existing
`map.routeStart` / `map.routeEnd` for the start/end marker tooltips.

## Out of scope (future)

- Per-operator / per-trip km breakdown (separate features, deferred).
- Backend `ST_Simplify` polyline + matching noise-capped distance (Approach C
  optimisation).
- Clicking a chart bar to open the route (table-cell trigger only for v1).
- Including the map in the printable report.

## Testing

- `./strawboss.sh typecheck admin` + `./strawboss.sh lint` + build admin-web.
- Manual: click a cell with data → polyline appears and fits bounds; a 0-km cell
  is not clickable; toggling the same cell closes the panel; changing the date
  range / truck selection behaves correctly; single-point day shows the notice.
