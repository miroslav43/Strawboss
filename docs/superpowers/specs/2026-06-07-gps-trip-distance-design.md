# Spec: Remove manual km input, derive trip distance from GPS

**Date:** 2026-06-07
**Status:** Approved (pending user review)
**Area:** mobile (driver flow), backend (trips/reconciliation/alerts/CMR), shared validation/types/domain, admin-web

## Problem

In the driver delivery flow the odometer is typed manually twice:

- **Plecare** — `apps/mobile/app/driver-ops/departure-flow.tsx` (`departureOdometerKm`)
- **Sosire** — `apps/mobile/app/driver-ops/arrival-flow.tsx` (`arrivalOdometerKm`)

These produce the generated column `trips.odometer_distance_km`, which drives fuel
reconciliation, fraud/timing alerts, the CMR transport document, and the admin trip view.

The manual numbers are unreliable / irrelevant. The truck's real route distance should
come from its GPS track between **depart** and **arrive**.

## Key finding

`trips.gps_distance_km` already exists in the schema but **is never populated** (always NULL).
GPS pings are stored per machine in `machine_location_events` (`machine_id, recorded_at,
lon, lat`), not per trip. So this change must *build* the GPS-distance computation and
repoint every consumer — otherwise removing the odometer silently zeroes out reconciliation,
alerts and the CMR distance.

## Decisions

- **Route segment:** Depart → Arrive (the actual driving leg; `departure_at` → `arrival_at`).
- **When computed:** at `arrive` (immediately, from existing pings) **and** recomputed in the
  hourly reconciliation job for recently-arrived trips (catches pings that synced late).
- **Arrival UX:** no odometer screen. `arrival-flow.tsx` is deleted.
  - Trip-detail "Sosit la destinație" card → 1-tap enqueue of `arrive`.
  - Depot geofence (`deposit_entry`) → **10s auto-confirm countdown** (reuses
    `ConfirmCountdown`, like the field entry-confirm overlay): the trip moves to
    `arrived` automatically on expiry; the driver can confirm early ("Confirmă acum")
    or cancel. `ConfirmCountdown` gained an optional `confirmLabel` accept-now button.
- **No DB migration:** `gps_distance_km` already exists; old odometer columns stay (NULL going
  forward) to preserve historical data.

## Changes

### 1. Mobile — remove km windows
- `departure-flow.tsx`: delete the `'odometer'` step; open directly on the signature step.
  `depart` body → `{ driverSignature }`. Signature + 3s countdown unchanged.
- `arrival-flow.tsx`: **delete the file/route.**
- `trip/[tripId].tsx`:
  - "Sosit la destinație" card → enqueue `arrive` (`useTripTransition`, body `{}`,
    currentStatus `in_transit`) instead of navigating to arrival-flow.
  - Subtitles: "Introduceți km și semnați…" → "Semnați pentru a pleca";
    "Introduceți km la sosire" → "Confirmați sosirea".
- `GeofenceOverlay.tsx`: the `deposit_entry` popup becomes a 10s auto-confirm countdown
  (`DepositArrivalCountdown` → `ConfirmCountdown`) that enqueues `arrive` on expiry / early
  confirm; cancel leaves the trip `in_transit`.

### 2. Shared contracts
- `packages/validation/src/dtos/trip-transition.schema.ts`: `departSchema` drops
  `departureOdometerKm` (keeps `driverSignature`); `arriveSchema` → `z.object({})`.
- `packages/types/src/dtos/trip-transition.dto.ts`: matching field removals.

### 3. Backend — compute GPS distance
- `trips.service.ts` `arrive()`: stop writing `arrival_odometer_km`; in the same atomic UPDATE
  set `gps_distance_km` from a PostGIS sum (`ST_DistanceSphere` over consecutive
  `machine_location_events` for the trip's `truck_id` between `departure_at` and `NOW()`),
  reusing the `getKmByDay` pattern in `location.service.ts`. `COALESCE → 0` when no pings.
- `trips.service.ts` `depart()`: stop writing `departure_odometer_km`.
- `reconciliation.service.ts`: add `recomputeRecentTripDistances()` (recompute
  `gps_distance_km` for trips with `arrival_at >= NOW() - INTERVAL '2 hours'`); call it at the
  top of `reconciliation.processor.ts`.

### 4. Downstream consumers → GPS
- `reconciliation.service.ts` `reconcileFuelForMachine`: `SUM(odometer_distance_km)` →
  `SUM(COALESCE(gps_distance_km,0))`.
- `alerts.processor.ts`: remove the dead odometer-vs-GPS discrepancy check; timing/speed check
  uses `gps_distance_km`.
- CMR `cmr.service.ts` + `templates/cmr.hbs`: replace the 3 odometer rows with one
  "Distanță parcursă (GPS)" row from `gps_distance_km` (NULL at stage-1, filled at stage-2).
- Admin `TripDetail.tsx` + `messages/{en,ro}.json`: replace the 3 odometer rows with a single
  "Distanță GPS" / "GPS Distance" row (`gpsDistanceKm` already mapped in `trip-mapper.ts`).

### 5. Domain (consistency)
- `trip.machine.ts`: relax `DEPART`/`ARRIVE` guards so they no longer require odometer.
  (Backend Zod validation enforces payloads; the static transition map is unaffected.)
- Leave `odometer-gps.ts` fraud helper in place, unwired — harmless.

## Out of scope
Fuel-log odometer and machine `current_odometer_km` (separate, legitimate concept) stay.

## Risks / notes
- GPS jitter can slightly inflate raw pairwise distance. Mirror the existing `getKmByDay`
  raw-sum approach for consistency; tune later if numbers look off.
- `dashboard.service.ts` `odometer_anomalies` count will trend to 0 (those alerts no longer
  fire). Left as-is for now (harmless); can be retired separately.
- Old odometer columns / mobile SQLite columns remain unused; no device migration needed.

## Verification
- `./strawboss.sh typecheck all` and `./strawboss.sh build all` clean.
- Driver flow: depart asks only for signature; arrive is 1-tap; after arrive,
  `trips.gps_distance_km` is populated from the track.
- CMR stage-2 and admin TripDetail show GPS distance.
