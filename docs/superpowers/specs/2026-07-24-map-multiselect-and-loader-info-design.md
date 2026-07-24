# Map field multi-select + richer loader-picker info panel

**Date:** 2026-07-24
**Scope:** `apps/admin-web` only (dispatcher task boards + shared Leaflet map). No backend or DB
changes — both features are wired entirely from existing endpoints/hooks.
**Status:** Design approved by product owner (pending written-spec review).

---

## 1. Problem

On `/tasks/balers` and `/tasks/loaders` (`MachinePlanBoard.tsx`), assigning a field to a machine via
"Selectează pe hartă" opens `ParcelMapModal`, which is single-select: click one parcel → modal
closes → repeat the whole open/click/close cycle for every additional field. When several adjacent
fields need the same machine, this is slow.

On `/tasks/trucks` (`TruckPlanBoard.tsx`), picking a loader for a truck via
"Selectează loader pe hartă" opens `LoaderPickMapModal`. Clicking a loader marker only surfaces the
machine code + plate in the footer — no operator name, no GPS freshness, no sense of what the
loader is already working on today, even though all of that data is already being fetched.

## 2. Key facts (verified in code)

- `useBulkCreateTaskAssignments` (`packages/api/src/hooks/use-task-assignments.ts`) already exists,
  POSTs to the already-implemented `POST /api/v1/task-assignments/bulk`, and is **currently unused
  by any frontend code** — a ready-made batch-create path.
- `GET /task-assignments/by-machine-type/:date/:machineType` (backend `getByMachineType`) returns
  the same joined row shape for every machine type, **including `parcelId`/`parcelName`** for
  loader rows — `TruckPlanBoard.tsx` already fetches this (`rawLoaderAssignments`) but its local
  `Assignment` TS interface doesn't declare those fields, and `uniqueLoaders` (deduped by
  `machineId`) discards the per-parcel rows before they reach `LoaderPickMapModal`.
- `useMachineLocations()` (`MachineLastLocation`) already carries `operatorName` and `recordedAt`
  per machine; `LoaderPickMapModal` already fetches it (for marker rendering) but never surfaces
  `operatorName` in its own UI.
- `UserPresenceDot` (`components/shared/UserPresenceDot.tsx`, `variant="badge"`,
  `thresholdMs={MACHINE_ONLINE_WINDOW_MS}`) is the existing shared "online / N min ago" indicator,
  already used for machines elsewhere on these same boards (`AssignedMachineCard`, available-truck
  cards). Reused here instead of a new time-ago formatter.
- `ParcelMapModal` is also imported by `AssignmentModal.tsx` (`daily-plan/`), which is **dead code**
  — not routed from any page (`DailyPlanBoard`/`AssignmentModal` have no importers besides each
  other). Its call site needs a one-line update to keep typecheck green, nothing more.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Multi-select scope | `ParcelMapModal`, opened from `MachinePlanBoard.tsx`'s map-picker button only. |
| Multi-select interaction | Modal stays open; each parcel click toggles it in/out of the selection (no separate remove UI). |
| Confirm behavior | One "Confirmă (N)" button; on confirm, all N parcels are added to **the same machine** in one `useBulkCreateTaskAssignments` call. |
| `ParcelMapModal` public contract | `onSelect(parcelIds: string[])` uniformly (single-select callers just read `ids[0]`), so there is one modal implementation, not two. |
| Highlight rendering | New optional `LeafletMap` prop `selectedParcelIds?: Set<string>`; existing single-`selectedParcelId` callers (map page, other modals) are untouched. |
| Loader info panel fields | Operator name, GPS status + last-update (via `UserPresenceDot`), and count/names of parcels the loader is assigned to today. Explicitly **no** nearest-locality (declined by product owner). |
| Loader "today's fields" source | Full (non-deduped) `loaderAssignments` from `TruckPlanBoard`, grouped by `machineId` client-side — no new query. |

## 4. `ParcelMapModal` design

- Internal state: `selectedIds: Set<string>` (was `selectedId: string | null`).
- Click handler passed to `LeafletMap` toggles membership instead of replacing.
- Footer: replaces the single "Selectat: X" line with "{{n}} terenuri selectate: A, B, C…"
  (truncated with "+N" past a handful of names) plus a "Golește selecția" clear action; confirm
  button reads `t('tasks.confirmNFields', { n })` and is disabled at `n === 0`.
- `onSelect` prop becomes `(parcelIds: string[]) => void`. `AssignmentModal.tsx`'s call site changes
  from `onSelect={(id) => setSelectedParcelId(id)}` to `onSelect={(ids) => setSelectedParcelId(ids[0] ?? null)}`
  — the only edit to that otherwise-untouched dead-code file.

## 5. `LeafletMap` design

- New prop `selectedParcelIds?: Set<string>`. In the parcel-polygon render effect, the per-parcel
  `isSelected` check becomes:
  `selectedParcelIds ? selectedParcelIds.has(parcel.id) : parcel.id === selectedParcelId`.
- Add `selectedParcelIds` to that effect's dependency array. No other behavior changes — click
  handling, popups, and tooltips are unchanged; multi-select is purely a styling + modal-state
  concern, not a map-interaction concern.

## 6. `MachinePlanBoard.tsx` wiring

- `AssignedMachineCard`'s `<ParcelMapModal onSelect={(parcelId) => onAddParcel(machine.id, parcelId)} />`
  becomes `onSelect={(parcelIds) => onAddParcels(machine.id, parcelIds)}`.
- New `handleAddParcels(machineId, parcelIds)` in `MachinePlanBoard.tsx`, using
  `useBulkCreateTaskAssignments`:
  ```ts
  bulkCreateAssignment.mutate(
    parcelIds.map((parcelId) => ({
      assignmentDate: date,
      machineId,
      parcelId,
      status: AssignmentStatus.in_progress,
      sequenceOrder: 0,
    })),
  );
  ```
  Matches the existing single-add payload shape exactly (same `sequenceOrder: 0` convention already
  used by `handleAddParcel`), just batched into one request/one invalidation.
- The list-based picker (`FarmParcelCascade`) keeps calling `onAddParcel` (single) unchanged — only
  the map picker becomes multi/bulk.

## 7. `LoaderPickMapModal` design

- New props: `parcelsByLoaderMachineId?: Map<string, string[]>` (parcel names per loader machine,
  for "today's fields") — computed once in `TruckPlanBoard.tsx` from the full `loaderAssignments`
  array (not `uniqueLoaders`) and passed down.
- `LoaderAssignmentRow` gains nothing new — operator name and GPS come from the `locations` array
  already fetched inside this modal (`useMachineLocations`); look up
  `locations.find((l) => l.machineId === selectedMachineId)`.
- Selected-state footer becomes a small info card:
  - Header row: `machineCode (registrationPlate)` (unchanged) + `UserPresenceDot` badge using the
    matched location's `recordedAt`.
  - Operator row: `t('leaflet.operatorLabel')`: `operatorName` (reusing the existing i18n key from
    `LeafletMap`'s popup strings), omitted if null.
  - Fields-today row: `t('tasks.workingToday', { fields: names.join(', ') })` when
    `parcelsByLoaderMachineId.get(machineId)` is non-empty, else `t('tasks.noFieldsToday')`.

## 8. `TruckPlanBoard.tsx` wiring

- Widen the local `Assignment` interface (or add a narrower type just for this) to include
  `parcelId: string | null; parcelName: string | null;` — the fields are already present at
  runtime, just undeclared.
- Compute `parcelsByLoaderMachineId` from the full `loaderAssignments` (pre-dedup), grouping
  non-null `parcelName` values by `machineId`.
- Pass it into `<LoaderPickMapModal parcelsByLoaderMachineId={...} />`.

## 9. Non-goals

- No change to `/tasks` (`TasksOverviewPage`), `DepositMapModal`, or any depot-related picker.
- No change to how loaders/balers are matched to trucks (`parentAssignmentId` logic) — purely an
  information-density change to the existing picker.
- No nearest-locality data in the loader panel (explicitly declined).
- `AssignmentModal.tsx` / `DailyPlanBoard.tsx` (dead code) get only the one-line signature fix
  needed to keep typecheck passing — no functional changes.

## 10. Verification

- `./strawboss.sh typecheck admin-web` (product owner builds/runs the UI himself per standing
  preference).
- Manual: on `/tasks/balers`, open "Selectează pe hartă" for a press, click 3 adjacent fields,
  confirm once, verify all 3 appear as separate rows on the machine card. On `/tasks/trucks`, open
  "Selectează loader pe hartă", click a loader with an active operator and at least one field
  assigned today, verify operator name + GPS badge + field list render correctly; click a loader
  with no fields assigned, verify the "no fields today" fallback.

## 11. Affected files

- `apps/admin-web/src/components/features/tasks/daily-plan/ParcelMapModal.tsx` — multi-select.
- `apps/admin-web/src/components/features/tasks/daily-plan/AssignmentModal.tsx` — one-line call-site fix.
- `apps/admin-web/src/components/map/LeafletMap.tsx` — `selectedParcelIds` prop.
- `apps/admin-web/src/components/features/tasks/machine-plan/MachinePlanBoard.tsx` — bulk-add wiring.
- `apps/admin-web/src/components/features/tasks/machine-plan/LoaderPickMapModal.tsx` — info panel.
- `apps/admin-web/src/components/features/tasks/machine-plan/TruckPlanBoard.tsx` — widen type, compute/pass `parcelsByLoaderMachineId`.
- `apps/admin-web/messages/en.json`, `apps/admin-web/messages/ro.json` — new i18n keys.
