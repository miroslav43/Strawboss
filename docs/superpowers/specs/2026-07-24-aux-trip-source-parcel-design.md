# Aux trip confirm: pickup source = depot OR field

**Date:** 2026-07-24
**Scope:** `supabase/migrations`, `packages/types`, `packages/validation`, `packages/api`,
`backend/service/src/trip-requests`, `backend/service/src/messaging`, `apps/admin-web`
(`trip-requests` feature). No mobile changes.
**Status:** Design approved by product owner (pending written-spec review).

---

## 1. Problem

`ConfirmRequestModal` (opened from the intake card on the Curse page's aux section, via
`AuxTripSection.tsx`) is how a dispatcher confirms a pending `trip_requests` row into a one-time
auxiliary truck. Today it **requires** a pickup depot (`trip_requests.source_depot_id`) — a plain
`<select>` of `delivery_destinations`. There is no way to say "this truck picks up straight from a
field" at confirm time; the dispatcher wants that as a first-class alternative, reusing the same
farm→parcel picker (`FarmParcelCascade`) already used on the task boards.

## 2. Key facts (verified in code)

- **The confirm-time source is informational, not the trip's real source.** The trip
  (`trips.source_parcel_id`) is materialized later, when the dispatcher assigns a **loader** to the
  minted aux truck on `/tasks/trucks` (`TruckPlanBoard.tsx`'s "Loader selector", unaffected by this
  feature). `autoUpsertAuxiliaryTrip` (`backend/service/src/trips/trips.service.ts:2864-3027`) reads
  `sourceParcelId` from the **loader's own task** (`parent.parcel_id`), and its `trips` INSERT
  (2986-3004) never references `trip_requests.source_depot_id` at all. So today's depot picker
  already only drives the pickup **communicated to the external driver** (email/SMS) — this feature
  adds a field option with the exact same, already-established scope. No change to
  `autoUpsertAuxiliaryTrip` or the truck-board loader assignment flow.
- **The "Deposit selector" hidden for aux trucks on `TruckPlanBoard.tsx:474-481`** is a *different*
  concept — the truck's **destination** (`task_assignments.destination_id`), hidden for aux because
  the destination is the external customer's own address, not one of our depots. Unrelated to this
  feature's *source* picker.
- `trip_requests.source_depot_id` (migration `00070_trip_request_source_depot.sql`) is a plain
  nullable FK, no DB-level CHECK — exclusivity is enforced at the Zod layer elsewhere in this
  codebase (`registerLoadSchema`, `forceStatusSchema` in
  `packages/validation/src/dtos/trip-transition.schema.ts`), via
  `.refine((d) => !!d.parcelId !== !!d.sourceDepotId, ...)`. The new `source_parcel_id` column
  mirrors this: nullable FK, no DB CHECK, XOR enforced in `confirmTripRequestSchema`.
- Org-scoped parcel validation already has an established pattern to mirror
  (`backend/service/src/trips/trips.service.ts:585-591`, same shape in `bale-loads.service.ts:64`
  and `task-assignments.service.ts:592,710`): a `SELECT id FROM parcels WHERE id=... AND
  organization_id=... AND deleted_at IS NULL` existence check.
- `transport-confirmation.processor.ts` (BullMQ job triggered from `confirm()`) queries
  `delivery_destinations` for `name/address/coords` (falls back to `ST_Centroid(boundary)`), builds
  an OSRM route + static map only `if (pickupCoords && deliveryCoords)`, and renders a `pickup`
  block (`label/address/mapsUrl`) into the email/SMS to the external driver. Per product decision
  (§3), the field-source branch supplies only a label — no coordinates, so the existing
  `if (pickupCoords && deliveryCoords)` gate naturally skips the route/map for a field pickup.
- `FarmParcelCascade` (`apps/admin-web/src/components/features/tasks/machine-plan/FarmParcelCascade.tsx`)
  takes `{ parcels, excludeParcelIds, assignedCountByParcel, color, onSelect, onClose }`; groups are
  derived client-side from `parcel.farmId`/`farmName` (no extra fetch). The "already assigned"
  badge (`already > 0 && ...`) is skipped entirely when the count is 0, so passing an empty
  `Map()` is inert, not misleading.
- `useParcels(apiClient)` (`packages/api/src/hooks/use-parcels.ts`) is the existing hook
  `MachinePlanBoard.tsx` already uses to feed `FarmParcelCascade` — reused as-is here.
- `AuxTripSection.tsx` owns two separate `useTripRequests` queries (an unfiltered `pending` one and
  a filtered/capped ledger of confirmed/cancelled requests) — the ledger is capped and
  date/search-filtered, so it is **not** a reliable source for an accurate "N other pickups already
  queued from this field" count. Confirmed with product owner: skip that count for now rather than
  show a number that could be silently wrong (§3).

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Screen | `ConfirmRequestModal.tsx` (the existing depot-confirm modal) — confirmed with product owner, not `TruckPlanBoard`. |
| Depot vs. field UI | Two tabs at the top of the modal, "Depozit" / "Câmp". Default tab = Depozit (keeps current behavior when untouched). |
| Field picker | Full `FarmParcelCascade` reuse — search, farm→parcel cascade, map picker — same richness as the task boards. |
| "Already assigned" counter on the field picker | Pass an empty `Map()` — the badge is naturally suppressed at 0 by the component itself. A real "other aux pickups already queued here" count is explicitly deferred (would need a dedicated backend aggregate; the data available client-side today is filtered/capped and would lie). |
| Email/SMS to external driver, field source | Label only ("<parcel code>, <farm name>") — **no** route/distance/static-map computed from the parcel's centroid. Depot source keeps its existing full route behavior. Deferred to a future iteration if wanted. |
| Trip materialization (`autoUpsertAuxiliaryTrip`) | **Unchanged.** The confirm-time source stays informational only, matching today's depot behavior exactly. |

## 4. Data model

- New migration `00090_trip_request_source_parcel.sql` (idempotent, mirrors
  `00070_trip_request_source_depot.sql`'s style):
  ```sql
  ALTER TABLE trip_requests
    ADD COLUMN IF NOT EXISTS source_parcel_id UUID REFERENCES parcels(id);

  CREATE INDEX IF NOT EXISTS idx_trip_requests_source_parcel
    ON trip_requests (source_parcel_id)
    WHERE source_parcel_id IS NOT NULL;
  ```
- `packages/types/src/entities/trip-request.ts`: add `sourceParcelId: string | null` next to the
  existing `sourceDepotId`, and `sourceParcelName?: string | null` next to `sourceDepotName?` (both
  populated the same way — joined in `list()`/`findById()`).
- The trip-request column list in `trip-requests.service.ts` (`source_depot_id AS "sourceDepotId"`
  at line 108, joined `sourceDepotName` at line 115) gains a sibling pair:
  `trip_requests.source_parcel_id AS "sourceParcelId"`, and a joined
  `(SELECT p.code || ', ' || p.farm_name FROM parcels p WHERE p.id = trip_requests.source_parcel_id) AS "sourceParcelName"`,
  in the same style as the existing depot join.

## 5. Validation (`packages/validation`)

`confirmTripRequestSchema` (`packages/validation/src/schemas/trip-request.schema.ts:143-149`)
becomes:
```ts
export const confirmTripRequestSchema = z
  .object({
    internalCode: z.string().min(1).max(40).optional(),
    depotId: uuidSchema.optional(),
    parcelId: uuidSchema.optional(),
  })
  .refine((d) => !!d.depotId !== !!d.parcelId, {
    message: 'exactly one of depotId or parcelId is required',
  });
```
Mirrors the established XOR pattern in `registerLoadSchema`/`forceStatusSchema`.

## 6. Backend

- `TripRequestsController.confirm` (`trip-requests.controller.ts:65-72`): DTO/body now carries
  `depotId?`/`parcelId?` instead of a required `depotId`.
- `TripRequestsService.confirm(orgId, id, userId, depotId?, parcelId?, internalCode?)`
  (`trip-requests.service.ts:335-402`):
  - When `parcelId` is given: validate org ownership with the established
    `SELECT id FROM parcels WHERE id=... AND organization_id=... AND deleted_at IS NULL` check
    (mirroring `trips.service.ts:585-591`), else `BadRequestException('Parcelă invalidă.')`.
  - The `UPDATE trip_requests` sets `source_parcel_id = ${parcelId}::uuid` (and leaves
    `source_depot_id` NULL) on the field branch, symmetric to the existing depot branch.
  - The `transport-confirmation` job payload gains `parcelId` alongside `depotId` (whichever is
    set).
- `TransportConfirmationProcessor.process` (`transport-confirmation.processor.ts`): branch on
  which of `depotId`/`parcelId` is present.
  - Depot branch: unchanged (existing `delivery_destinations` query + route/map block).
  - Parcel branch: query `parcels` for `code`/`farm_name` (join to `farms` if `farm_name` isn't
    denormalized on `parcels`), set `pickup = { label: '<code>, <farm_name>', address: null,
    mapsUrl: null }`, and leave `pickupCoords = null` — the existing
    `if (pickupCoords && deliveryCoords)` gate then skips OSRM/static-map/distance automatically,
    no new conditional needed there.

## 7. Frontend

- `packages/api/src/hooks/use-trip-requests.ts` (`useConfirmTripRequest`, lines 39-58): mutation
  variables become `{ id: string; internalCode?: string; depotId?: string; parcelId?: string }` —
  both optional at the type level, same shape as `registerLoadSchema`/`forceStatusSchema`'s DTOs,
  with the XOR enforced by `confirmTripRequestSchema` at the backend boundary. Body sends whichever
  of `depotId`/`parcelId` is set.
- `ConfirmRequestModal.tsx`:
  - New local state `sourceType: 'depot' | 'field'` (default `'depot'`), `selectedParcelId: string
    | null`.
  - Two tab buttons above the existing depot `<select>` block, styled consistently with other
    tab/segmented-control patterns already in admin-web.
  - Depot tab: existing `<select>` + preselect-default effect, untouched.
  - Field tab: fetch `useParcels(apiClient)`, filter/normalize the same way `MachinePlanBoard`
    does, render `FarmParcelCascade` with `excludeParcelIds={new Set()}`,
    `assignedCountByParcel={new Map()}`, `onSelect={setSelectedParcelId}`.
  - "Preluare de la" preview block (lines 98-115 today) reads from whichever tab is active —
    depot name+address, or `"<parcel code>, <farm name>"` for the field tab.
  - `handleSubmit`: requires `depotId` (depot tab) or `selectedParcelId` (field tab); calls
    `confirm.mutate({ id, depotId, internalCode } | { id, parcelId, internalCode }, { onSuccess:
    () => onClose() })`.
  - Submit button `disabled` condition extends to cover both tabs.
- i18n: new keys `tripRequests.sourceTypeDepot`, `tripRequests.sourceTypeField` (tab labels); the
  field tab reuses `tasks.searchFarms`, `tasks.searchParcels`, `tasks.noFarms`,
  `tasks.noParcelsInFarm`, `tasks.pickFarmFirst`, `tasks.unassignedFarm` already defined for
  `FarmParcelCascade` elsewhere.

## 8. Explicitly out of scope

- No change to `autoUpsertAuxiliaryTrip` or the truck-board loader-assignment flow — the real
  trip source stays driven by the assigned loader's task, unchanged.
- No route/distance/static-map computation for a field-sourced pickup in the confirmation
  email/SMS (label only).
- No accurate "N other aux pickups already queued from this field" counter (would need a
  dedicated backend aggregate query against unfiltered, uncapped data — worth a future iteration).
- No mobile app changes — this flow is entirely admin-web/dispatcher-facing.

## 9. Manual verification plan

1. Confirm a pending aux request via the **Depozit** tab exactly as today — unchanged behavior,
   regression check.
2. Confirm a pending aux request via the **Câmp** tab: pick a farm → parcel via search, and via
   "select on map"; verify `trip_requests.source_parcel_id` is set and `source_depot_id` is NULL
   in the DB afterward.
3. Verify the confirmation email/SMS to the external driver shows the field's code + farm name
   with no map/route block when field-sourced, and the existing route/map block when
   depot-sourced.
4. Attempt confirm with neither/both selected — expect the submit button disabled client-side and
   a 400 from the backend if forced directly.
5. Confirm cross-org rejection: a `parcelId` from another organization is rejected with
   `BadRequestException`.
6. Typecheck all touched packages (`types`, `validation`, `api`, `backend`, `admin-web`).
