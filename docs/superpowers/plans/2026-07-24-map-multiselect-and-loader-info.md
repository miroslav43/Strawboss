# Map Field Multi-Select + Loader Info Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dispatcher pick several parcels at once in the map-based field picker (bulk-adding
them to one machine's task list in a single request), and show a richer info panel (operator, GPS
freshness, today's assigned fields) when clicking a loader marker in the truck task board's loader
picker.

**Architecture:** Two independent, additive UI changes in `apps/admin-web`, both reusing existing
backend endpoints/hooks (`useBulkCreateTaskAssignments`, `useMachineLocations`) and an existing
shared component (`UserPresenceDot`). No backend, DB, or shared-package changes.

**Tech Stack:** Next.js 15 App Router, React, TanStack Query (`@strawboss/api` hooks), Leaflet
(`@/components/map/LeafletMap`), the project's `messages/{en,ro}.json` i18n catalogs.

## Global Constraints

- No backend or migration changes — spec §2/§9 confirm both features are wired entirely from
  already-existing endpoints/hooks.
- `apps/admin-web` has **no test runner** (`package.json` has no `test` script, no jest/vitest
  config) — verification for every task is `./strawboss.sh typecheck admin-web` plus the manual
  check described in the task, not an automated test suite. The product owner builds/runs the UI
  himself (standing preference) — do not run `pnpm dev` or `next build` as part of these tasks.
- Every user-facing string goes through `t('tasks....')` / `t('leaflet....')` with keys added to
  **both** `apps/admin-web/messages/en.json` and `apps/admin-web/messages/ro.json` — never a
  hardcoded string in JSX.
- `ParcelMapModal`'s public contract changes from `onSelect(parcelId: string)` to
  `onSelect(parcelIds: string[])` — every call site must be updated in the same commit that changes
  the modal, so the app never sits in a state where the contract and its only two callers disagree.

---

### Task 1: Add new i18n keys (multi-select + loader info panel)

**Files:**
- Modify: `apps/admin-web/messages/en.json:719-720`
- Modify: `apps/admin-web/messages/ro.json:719-720`

**Interfaces:**
- Produces: `t('tasks.confirmNFields', { n })`, `t('tasks.fieldsSelectedList', { n, names })`,
  `t('tasks.clearSelection')`, `t('tasks.workingToday', { fields })`, `t('tasks.noFieldsToday')` —
  consumed by Task 2 (`ParcelMapModal`) and Task 6 (`LoaderPickMapModal`).

- [ ] **Step 1: Add the five keys to `en.json`**

Both locale files have the same key ordering; insert these five keys right after
`"noLoaderOnMap"` and before `"confirm"` (currently line 719/720 in both files):

```json
    "noLoaderOnMap": "No loaders with GPS on the map — use the dropdown.",
    "fieldsSelectedList": "{{n}} fields selected: {{names}}",
    "confirmNFields": "Confirm ({{n}})",
    "clearSelection": "Clear selection",
    "workingToday": "Working today on: {{fields}}",
    "noFieldsToday": "No fields assigned today",
    "confirm": "Confirm",
```

- [ ] **Step 2: Add the same five keys to `ro.json`, translated**

```json
    "noLoaderOnMap": "Niciun încărcător cu GPS pe hartă — folosește lista.",
    "fieldsSelectedList": "{{n}} terenuri selectate: {{names}}",
    "confirmNFields": "Confirmă ({{n}})",
    "clearSelection": "Golește selecția",
    "workingToday": "Lucrează azi pe: {{fields}}",
    "noFieldsToday": "Niciun teren alocat azi",
    "confirm": "Confirmă",
```

- [ ] **Step 3: Verify both JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin-web/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/admin-web/messages/ro.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/messages/en.json apps/admin-web/messages/ro.json
git commit -m "i18n: add keys for map multi-select + loader info panel"
```

---

### Task 2: `LeafletMap` — support highlighting multiple selected parcels

**Files:**
- Modify: `apps/admin-web/src/components/map/LeafletMap.tsx:151` (props interface)
- Modify: `apps/admin-web/src/components/map/LeafletMap.tsx:224` (destructure + default)
- Modify: `apps/admin-web/src/components/map/LeafletMap.tsx:608` (isSelected calc)
- Modify: `apps/admin-web/src/components/map/LeafletMap.tsx:663-672` (effect deps)

**Interfaces:**
- Produces: new optional prop `selectedParcelIds?: Set<string>` on `LeafletMap` — consumed by
  Task 3 (`ParcelMapModal`). All existing callers (which don't pass it) are unaffected.

- [ ] **Step 1: Add the prop to `LeafletMapProps`**

In the interface (currently `selectedParcelId: string | null;` at line 151), add directly below it:

```ts
  selectedParcelId: string | null;
  /** When set, highlights ALL of these parcels (multi-select map pickers). Takes
   *  precedence over selectedParcelId. */
  selectedParcelIds?: Set<string>;
```

- [ ] **Step 2: Destructure the prop in the component**

In the `LeafletMap` function's destructured params (currently `selectedParcelId,` at line 201),
add directly below it:

```ts
  selectedParcelId,
  selectedParcelIds,
```

- [ ] **Step 3: Use it in the parcel-polygon render effect**

Find (§2, inside the `parcels.forEach` callback, currently line 608):

```ts
        const isSelected = parcel.id === selectedParcelId;
```

Replace with:

```ts
        const isSelected = selectedParcelIds
          ? selectedParcelIds.has(parcel.id)
          : parcel.id === selectedParcelId;
```

- [ ] **Step 4: Add the new prop to the effect's dependency array**

Find the dependency array closing that same effect (currently ending `selectionOnly, editingId,`
around line 663-672):

```ts
  }, [
    parcels,
    selectedParcelId,
    showParcels,
    hiddenParcelIds,
    mapReady,
    mapStrings,
    selectionOnly,
    editingId,
  ]);
```

Replace with:

```ts
  }, [
    parcels,
    selectedParcelId,
    selectedParcelIds,
    showParcels,
    hiddenParcelIds,
    mapReady,
    mapStrings,
    selectionOnly,
    editingId,
  ]);
```

- [ ] **Step 5: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: passes with no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/components/map/LeafletMap.tsx
git commit -m "feat(map): support highlighting multiple selected parcels"
```

---

### Task 3: `ParcelMapModal` — multi-select rewrite

**Files:**
- Modify: `apps/admin-web/src/components/features/tasks/daily-plan/ParcelMapModal.tsx` (full rewrite)

**Interfaces:**
- Consumes: `LeafletMap`'s `selectedParcelIds?: Set<string>` prop (Task 2).
- Produces: `ParcelMapModalProps.onSelect` changes signature from `(parcelId: string) => void` to
  `(parcelIds: string[]) => void` — Task 4 (`AssignmentModal.tsx`) and Task 5
  (`MachinePlanBoard.tsx`) both update their call sites in lockstep with this task.

- [ ] **Step 1: Replace the full file contents**

```tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MapPin, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Parcel } from '@strawboss/types';

const LeafletMap = dynamic(
  () => import('@/components/map/LeafletMap').then((m) => m.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    ),
  },
);

interface ParcelMapModalProps {
  parcels: Parcel[];
  onSelect: (parcelIds: string[]) => void;
  onClose: () => void;
}

const MAX_NAMES_SHOWN = 3;

export function ParcelMapModal({ parcels, onSelect, onClose }: ParcelMapModalProps) {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const names = parcels
    .filter((p) => selectedIds.has(p.id))
    .map((p) => p.name ?? p.code);
  const namesLabel =
    names.length > MAX_NAMES_SHOWN
      ? `${names.slice(0, MAX_NAMES_SHOWN).join(', ')} +${names.length - MAX_NAMES_SHOWN}`
      : names.join(', ');

  const toggleParcel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <MapPin className="h-5 w-5 text-primary" />
            {t('tasks.selectOnMap')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Map */}
        <div className="min-h-0 flex-1">
          <LeafletMap
            parcels={parcels}
            machines={[]}
            selectedParcelId={null}
            selectedParcelIds={selectedIds}
            onParcelSelect={toggleParcel}
            onParcelEdit={() => {}}
            onParcelDelete={() => {}}
            hiddenParcelIds={new Set()}
            hiddenMachineIds={new Set()}
            selectionOnly
          />
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-1 border-t border-neutral-200 px-6 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            {selectedIds.size > 0 ? (
              <p className="truncate">
                {t('tasks.fieldsSelectedList', { n: selectedIds.size, names: namesLabel })}
              </p>
            ) : (
              <p>{t('tasks.clickParcelOnMap')}</p>
            )}
            <p className="text-xs text-neutral-400">{t('tasks.mapParcelsNeedBoundary')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-sm font-medium text-neutral-500 hover:text-neutral-700"
              >
                {t('tasks.clearSelection')}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                if (selectedIds.size > 0) {
                  onSelect(Array.from(selectedIds));
                  onClose();
                }
              }}
              disabled={selectedIds.size === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('tasks.confirmNFields', { n: selectedIds.size })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note: this intentionally does **not** typecheck cleanly on its own — `AssignmentModal.tsx` and
`MachinePlanBoard.tsx` still call the old single-id `onSelect`. Task 4 and Task 5 fix both call
sites; do not run typecheck as a gate until Task 5 is done. Do not skip Steps 2-3 below.

- [ ] **Step 2: Confirm both call sites are still on the old signature (expected, not a bug)**

Run: `grep -n "onSelect={" apps/admin-web/src/components/features/tasks/daily-plan/AssignmentModal.tsx apps/admin-web/src/components/features/tasks/machine-plan/MachinePlanBoard.tsx`
Expected: two matches, both still destructuring a single id (e.g. `onSelect={(id) => ...}` /
`onSelect={(parcelId) => ...}`) — confirms Task 4/5 have real work to do.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/components/features/tasks/daily-plan/ParcelMapModal.tsx
git commit -m "feat(tasks): ParcelMapModal supports multi-select field picking"
```

---

### Task 4: `AssignmentModal` — update to the new `ParcelMapModal` contract

**Files:**
- Modify: `apps/admin-web/src/components/features/tasks/daily-plan/AssignmentModal.tsx:103-114`

**Interfaces:**
- Consumes: `ParcelMapModal`'s new `onSelect(parcelIds: string[]) => void` (Task 3).

This file (`AssignmentModal.tsx`, and its only other importer `DailyPlanBoard.tsx`) is not routed
from any page — confirmed via `grep -rln "DailyPlanBoard" apps/admin-web/src` returning only the
file itself. This is a mechanical fix to keep it compiling, not a functional change.

- [ ] **Step 1: Update the `ParcelMapModal` call site**

Find:

```tsx
  if (showMap) {
    return (
      <ParcelMapModal
        parcels={parcels.filter((p) => p.isActive)}
        onSelect={(id) => {
          setSelectedParcelId(id);
          setShowMap(false);
        }}
        onClose={() => setShowMap(false)}
      />
    );
  }
```

Replace with:

```tsx
  if (showMap) {
    return (
      <ParcelMapModal
        parcels={parcels.filter((p) => p.isActive)}
        onSelect={(ids) => {
          setSelectedParcelId(ids[0] ?? null);
          setShowMap(false);
        }}
        onClose={() => setShowMap(false)}
      />
    );
  }
```

- [ ] **Step 2: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: the `AssignmentModal.tsx` error from Task 3 is gone; only the `MachinePlanBoard.tsx`
call-site error (fixed in Task 5) remains, if any.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/components/features/tasks/daily-plan/AssignmentModal.tsx
git commit -m "fix(tasks): update AssignmentModal to ParcelMapModal's array onSelect"
```

---

### Task 5: `MachinePlanBoard` — bulk-add selected parcels via `useBulkCreateTaskAssignments`

**Files:**
- Modify: `apps/admin-web/src/components/features/tasks/machine-plan/MachinePlanBoard.tsx`

**Interfaces:**
- Consumes: `ParcelMapModal`'s new `onSelect(parcelIds: string[]) => void` (Task 3);
  `useBulkCreateTaskAssignments(client)` from `@strawboss/api` (existing, previously unused —
  mutation fn signature `(data: Partial<TaskAssignment>[]) => Promise<TaskAssignment[]>`).
- Produces: `AssignedMachineCardProps.onAddParcels: (machineId: string, parcelIds: string[]) => void`
  — new prop, sibling to the existing `onAddParcel`.

- [ ] **Step 1: Import `useBulkCreateTaskAssignments`**

Find the `@strawboss/api` import block:

```ts
import {
  useTasksByMachineType,
  useCreateTaskAssignment,
  useDeleteTaskAssignment,
  useParcels,
  useMachines,
  useMachineLocations,
  useAdminUsers,
  queryKeys,
} from '@strawboss/api';
```

Replace with:

```ts
import {
  useTasksByMachineType,
  useCreateTaskAssignment,
  useBulkCreateTaskAssignments,
  useDeleteTaskAssignment,
  useParcels,
  useMachines,
  useMachineLocations,
  useAdminUsers,
  queryKeys,
} from '@strawboss/api';
```

- [ ] **Step 2: Add the `onAddParcels` prop to `AssignedMachineCard`'s props type and signature**

Find the `AssignedMachineCard` props type (the object type in its function signature):

```ts
  onAddParcel: (machineId: string, parcelId: string) => void;
  onAddDepot: (machineId: string, destinationId: string) => void;
```

Replace with:

```ts
  onAddParcel: (machineId: string, parcelId: string) => void;
  onAddParcels: (machineId: string, parcelIds: string[]) => void;
  onAddDepot: (machineId: string, destinationId: string) => void;
```

Then find the destructured params of the `AssignedMachineCard` function:

```ts
  onAddParcel,
  onAddDepot,
```

Replace with:

```ts
  onAddParcel,
  onAddParcels,
  onAddDepot,
```

- [ ] **Step 3: Wire the new prop into the map-picker call site inside `AssignedMachineCard`**

Find:

```tsx
      {showParcelMap && (
        <ParcelMapModal
          parcels={eligibleParcelsForMap}
          onSelect={(parcelId) => {
            onAddParcel(machine.id, parcelId);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
```

Replace with:

```tsx
      {showParcelMap && (
        <ParcelMapModal
          parcels={eligibleParcelsForMap}
          onSelect={(parcelIds) => {
            onAddParcels(machine.id, parcelIds);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
```

- [ ] **Step 4: Add the `bulkCreateAssignment` mutation and `handleAddParcels` handler in `MachinePlanBoard`**

Find:

```ts
  const createAssignment = useCreateTaskAssignment(apiClient);
  const deleteAssignment = useDeleteTaskAssignment(apiClient);
```

Replace with:

```ts
  const createAssignment = useCreateTaskAssignment(apiClient);
  const bulkCreateAssignment = useBulkCreateTaskAssignments(apiClient);
  const deleteAssignment = useDeleteTaskAssignment(apiClient);
```

Then find the end of `handleAddParcel` (it ends with `[date, machineType, createAssignment],\n  );`
right before `handleAddDepot`):

```ts
  const handleAddParcel = useCallback(
    (machineId: string, parcelId: string) => {
      clientLogger.flow('Machine plan: add parcel to machine', {
        board: 'machine-plan',
        planDate: date,
        machineType,
        machineId,
        parcelId,
      });
      createAssignment.mutate({
        assignmentDate: date,
        machineId,
        parcelId,
        status: AssignmentStatus.in_progress,
        sequenceOrder: 0,
      });
    },
    [date, machineType, createAssignment],
  );
```

Add directly below it (before `handleAddDepot`):

```ts
  const handleAddParcels = useCallback(
    (machineId: string, parcelIds: string[]) => {
      if (parcelIds.length === 0) return;
      clientLogger.flow('Machine plan: bulk add parcels to machine', {
        board: 'machine-plan',
        planDate: date,
        machineType,
        machineId,
        parcelCount: parcelIds.length,
      });
      bulkCreateAssignment.mutate(
        parcelIds.map((parcelId) => ({
          assignmentDate: date,
          machineId,
          parcelId,
          status: AssignmentStatus.in_progress,
          sequenceOrder: 0,
        })),
      );
    },
    [date, machineType, bulkCreateAssignment],
  );
```

- [ ] **Step 5: Pass the handler down at the `AssignedMachineCard` call site**

Find (in the `assignedMachines.map(...)` render):

```tsx
              <AssignedMachineCard
                key={m.id}
                machine={m}
                operator={operatorByMachineId.get(m.id) ?? null}
                assignments={assignmentsByMachine.get(m.id) ?? []}
                parcels={parcels}
                assignedCountByParcel={assignedCountByParcel}
                allowDepot={machineType === 'loader' || machineType === 'baler'}
                onAddParcel={handleAddParcel}
                onAddDepot={handleAddDepot}
```

Replace with:

```tsx
              <AssignedMachineCard
                key={m.id}
                machine={m}
                operator={operatorByMachineId.get(m.id) ?? null}
                assignments={assignmentsByMachine.get(m.id) ?? []}
                parcels={parcels}
                assignedCountByParcel={assignedCountByParcel}
                allowDepot={machineType === 'loader' || machineType === 'baler'}
                onAddParcel={handleAddParcel}
                onAddParcels={handleAddParcels}
                onAddDepot={handleAddDepot}
```

- [ ] **Step 6: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: passes cleanly — this closes out the `ParcelMapModal` contract change started in Task 3.

- [ ] **Step 7: Manual verification**

With the dev server running (product owner's own instance, or ask them to check): go to
`/tasks/balers`, assign a baler, click "Selectează pe hartă", click 3 different fields (each click
toggles a red highlight, modal stays open), click "Confirmă (3)", verify all 3 appear as separate
rows on the machine's card in one go (one network request in the browser Network tab, not three).

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/components/features/tasks/machine-plan/MachinePlanBoard.tsx
git commit -m "feat(tasks): bulk-add multi-selected fields to a machine in one request"
```

---

### Task 6: `TruckPlanBoard` — expose loader parcel data for the info panel

**Files:**
- Modify: `apps/admin-web/src/components/features/tasks/machine-plan/TruckPlanBoard.tsx`

**Interfaces:**
- Produces: `parcelsByLoaderMachineId: Map<string, string[]>` (parcel names per loader machine id,
  for today) — consumed by Task 7 (`LoaderPickMapModal`).

- [ ] **Step 1: Widen the local `Assignment` interface with the (already-present-at-runtime) parcel fields**

Find:

```ts
interface Assignment {
  id: string;
  machineId: string;
  machineCode: string;
  machineType: string;
  registrationPlate: string;
  parentAssignmentId: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationCode: string | null;
  status: string;
  assignedUserName?: string | null;
  assignedUserLastSeenAt?: string | null;
  tripId?: string | null;
  iterations?: TripIteration[];
}
```

Replace with:

```ts
interface Assignment {
  id: string;
  machineId: string;
  machineCode: string;
  machineType: string;
  registrationPlate: string;
  parentAssignmentId: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationCode: string | null;
  status: string;
  assignedUserName?: string | null;
  assignedUserLastSeenAt?: string | null;
  tripId?: string | null;
  iterations?: TripIteration[];
  parcelId?: string | null;
  parcelName?: string | null;
}
```

- [ ] **Step 2: Compute `parcelsByLoaderMachineId` from the full (pre-dedup) `loaderAssignments`**

Find the `uniqueLoaders` memo:

```ts
  // Unique loader assignments (one per loader)
  const uniqueLoaders = useMemo(() => {
    const seen = new Set<string>();
    return loaderAssignments.filter((a) => {
      if (seen.has(a.machineId)) return false;
      seen.add(a.machineId);
      return true;
    });
  }, [loaderAssignments]);
```

Add directly below it:

```ts
  // All parcel names each loader machine is assigned to today — used by the
  // loader-picker map modal's info panel. Built from the FULL (pre-dedup)
  // loaderAssignments so a loader working several fields shows all of them.
  const parcelsByLoaderMachineId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of loaderAssignments) {
      if (!a.parcelName) continue;
      const list = map.get(a.machineId) ?? [];
      list.push(a.parcelName);
      map.set(a.machineId, list);
    }
    return map;
  }, [loaderAssignments]);
```

- [ ] **Step 3: Pass it into `LoaderPickMapModal`**

Find:

```tsx
      {loaderMapForTruckAssignmentId != null && (
        <LoaderPickMapModal
          loaderAssignments={uniqueLoaders.map((la) => ({
            id: la.id,
            machineId: la.machineId,
            machineCode: la.machineCode,
            registrationPlate: la.registrationPlate,
          }))}
          onSelect={(loaderAssignmentId) => {
            handleSetLoader(loaderMapForTruckAssignmentId, loaderAssignmentId);
            setLoaderMapForTruckAssignmentId(null);
          }}
          onClose={() => setLoaderMapForTruckAssignmentId(null)}
        />
      )}
```

Replace with:

```tsx
      {loaderMapForTruckAssignmentId != null && (
        <LoaderPickMapModal
          loaderAssignments={uniqueLoaders.map((la) => ({
            id: la.id,
            machineId: la.machineId,
            machineCode: la.machineCode,
            registrationPlate: la.registrationPlate,
          }))}
          parcelsByLoaderMachineId={parcelsByLoaderMachineId}
          onSelect={(loaderAssignmentId) => {
            handleSetLoader(loaderMapForTruckAssignmentId, loaderAssignmentId);
            setLoaderMapForTruckAssignmentId(null);
          }}
          onClose={() => setLoaderMapForTruckAssignmentId(null)}
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: a new error only if Task 7 hasn't added the `parcelsByLoaderMachineId` prop to
`LoaderPickMapModalProps` yet — that's expected here; Task 7 closes it. Confirm no *other* new
errors were introduced by this task's own changes (widening a TS interface with optional fields
never breaks existing usages).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/components/features/tasks/machine-plan/TruckPlanBoard.tsx
git commit -m "feat(tasks): compute per-loader today's-fields map for the loader picker"
```

---

### Task 7: `LoaderPickMapModal` — richer info panel on marker selection

**Files:**
- Modify: `apps/admin-web/src/components/features/tasks/machine-plan/LoaderPickMapModal.tsx`

**Interfaces:**
- Consumes: `parcelsByLoaderMachineId?: Map<string, string[]>` (Task 6);
  `UserPresenceDot` (`@/components/shared/UserPresenceDot`, props `lastSeenAt`,
  `variant="badge"`, `thresholdMs`); `MACHINE_ONLINE_WINDOW_MS` from `@strawboss/types`;
  `t('leaflet.operatorLabel')`, `t('tasks.workingToday', { fields })`, `t('tasks.noFieldsToday')`
  (Task 1). `MachineLastLocation.operatorName` / `.recordedAt` (existing type, already fetched by
  this component's own `useMachineLocations` call).

- [ ] **Step 1: Add imports**

Find:

```tsx
import { useMachineLocations } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
```

Replace with:

```tsx
import { useMachineLocations } from '@strawboss/api';
import { MACHINE_ONLINE_WINDOW_MS } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { UserPresenceDot } from '@/components/shared/UserPresenceDot';
```

- [ ] **Step 2: Add the new prop to `LoaderPickMapModalProps` and the function signature**

Find:

```ts
export interface LoaderPickMapModalProps {
  loaderAssignments: LoaderAssignmentRow[];
  onSelect: (loaderAssignmentId: string) => void;
  onClose: () => void;
}

export function LoaderPickMapModal({
  loaderAssignments,
  onSelect,
  onClose,
}: LoaderPickMapModalProps) {
```

Replace with:

```ts
export interface LoaderPickMapModalProps {
  loaderAssignments: LoaderAssignmentRow[];
  parcelsByLoaderMachineId?: Map<string, string[]>;
  onSelect: (loaderAssignmentId: string) => void;
  onClose: () => void;
}

export function LoaderPickMapModal({
  loaderAssignments,
  parcelsByLoaderMachineId,
  onSelect,
  onClose,
}: LoaderPickMapModalProps) {
```

- [ ] **Step 3: Look up the selected marker's location + today's fields**

Find:

```ts
  const selectedRow = useMemo(() => {
    if (!selectedMachineId) return undefined;
    return loaderAssignments.find((r) => r.machineId === selectedMachineId);
  }, [loaderAssignments, selectedMachineId]);
```

Add directly below it:

```ts
  const selectedLocation = useMemo(
    () => locations.find((l) => l.machineId === selectedMachineId) ?? null,
    [locations, selectedMachineId],
  );

  const todaysFields = useMemo(
    () => (selectedMachineId ? (parcelsByLoaderMachineId?.get(selectedMachineId) ?? []) : []),
    [parcelsByLoaderMachineId, selectedMachineId],
  );
```

- [ ] **Step 4: Replace the footer's selected-state text with the info panel**

Find:

```tsx
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            {selectedRow ? (
              <p>
                {t('tasks.selected')}: {selectedRow.machineCode} ({selectedRow.registrationPlate})
              </p>
            ) : machinesOnMap.length === 0 ? (
              <p>{t('tasks.noLoaderOnMap')}</p>
            ) : (
              <p>{t('tasks.clickLoaderOnMap')}</p>
            )}
            <p className="text-xs text-neutral-400">{t('tasks.mapLoadersNeedGps')}</p>
          </div>
```

Replace with:

```tsx
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            {selectedRow ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-800">
                    {selectedRow.machineCode} ({selectedRow.registrationPlate})
                  </span>
                  {selectedLocation && (
                    <UserPresenceDot
                      lastSeenAt={selectedLocation.recordedAt}
                      variant="badge"
                      thresholdMs={MACHINE_ONLINE_WINDOW_MS}
                    />
                  )}
                </div>
                {selectedLocation?.operatorName && (
                  <p className="mt-1 text-xs text-neutral-600">
                    {t('leaflet.operatorLabel')}: {selectedLocation.operatorName}
                  </p>
                )}
                <p className="mt-1 text-xs text-neutral-500">
                  {todaysFields.length > 0
                    ? t('tasks.workingToday', { fields: todaysFields.join(', ') })
                    : t('tasks.noFieldsToday')}
                </p>
              </div>
            ) : machinesOnMap.length === 0 ? (
              <p>{t('tasks.noLoaderOnMap')}</p>
            ) : (
              <p>{t('tasks.clickLoaderOnMap')}</p>
            )}
            <p className="text-xs text-neutral-400">{t('tasks.mapLoadersNeedGps')}</p>
          </div>
```

- [ ] **Step 5: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: passes cleanly — this closes out the `parcelsByLoaderMachineId` prop threaded from
Task 6.

- [ ] **Step 6: Manual verification**

With the dev server running (product owner's own instance): go to `/tasks/trucks`, assign a truck,
click "Selectează loader pe hartă", click a loader marker whose operator is reporting GPS and who
has at least one field assigned today — verify the panel shows machine code + plate, a green/grey
GPS badge with "acum N min", the operator's name, and the field name(s). Click a loader with no
fields assigned today — verify it falls back to "Niciun teren alocat azi".

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/features/tasks/machine-plan/LoaderPickMapModal.tsx
git commit -m "feat(tasks): richer loader info panel (operator, GPS status, today's fields)"
```

---

## Self-Review Notes

- **Spec coverage:** §4 (ParcelMapModal) → Task 3; §5 (LeafletMap) → Task 2; §6 (MachinePlanBoard
  wiring) → Task 5; §7 (LoaderPickMapModal) → Task 7; §8 (TruckPlanBoard wiring) → Task 6; i18n keys
  from all sections → Task 1. All spec sections have a covering task.
- **Sequencing:** Task 3 intentionally leaves the build red for one commit (documented in its Step 2)
  because `ParcelMapModal`'s contract and its two callers must all change together conceptually;
  Tasks 4 and 5 close that out immediately after. Task 6/7 have the same relationship for
  `parcelsByLoaderMachineId`. If a subagent-driven executor insists on a green typecheck after every
  single task, merge Task 3+4+5 into one task and Task 6+7 into one task — but keep them as written
  if the executor tracks "this multi-task unit ends green" instead.
- **Type consistency checked:** `ParcelMapModalProps.onSelect` (Task 3) → both call sites (Task 4,
  Task 5) use `(ids) =>` / `(parcelIds) =>` consistently. `AssignedMachineCard.onAddParcels` (Task 5)
  signature `(machineId: string, parcelIds: string[]) => void` matches `handleAddParcels`'s
  signature exactly. `LoaderPickMapModalProps.parcelsByLoaderMachineId` (Task 7) matches the type
  produced in Task 6 (`Map<string, string[]>`) exactly.
