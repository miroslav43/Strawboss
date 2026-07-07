# 🟢 LOW — 22 tasks

> Part of the StrawBoss audit. See [`README.md`](./README.md) for full context, root causes (R1–R6), and the C5 keystore decision.
> Build order for shared-package edits: `types → validation → ui-tokens → domain → api → backend/admin-web`. Typecheck after each task: `./strawboss.sh typecheck all` (you run the UI build).

Grouped by shared fix pattern; each is small and independent. Safe to batch by group.

---

## Group A — Reliability / correctness
- **L1** `backend/service/src/documents/documents.controller.ts:39` — download bypasses the signing interceptor (`@Res()` without passthrough). **Fix:** drop `@Res()` and return `{url}` (or `@Res({passthrough:true})`), or sign `fileUrl` explicitly before `redirect`. Add a redirect-follow check for a `delivery_note`.
- **L2** `apps/mobile/src/lib/device-checkin.ts:641` — OTA APKs never deleted. **Fix:** on terminal deployment state, sweep `strawboss-ota-*.apk` older than N days from `documentDirectory`.
- **L3** `apps/mobile/src/components/features/fuel/FuelEntryFlow.tsx:135` (+ `ProductionNumpad.tsx`, `FieldActiveNumpad.tsx`, `ConsumableFlow.tsx`) — repo `create()` + `enqueue()` not atomic. **Fix:** wrap both in `db.withTransactionAsync()`, or add a startup reconciliation pass for `server_version=0` rows lacking a queue entry.
- **L4** `backend/service/src/geofence/geofence.service.ts:17–21` — `Number(env)||default` discards explicit `0`. **Fix:** `Number.isFinite(n) ? n : default`.
- **L5** `backend/service/src/trips/trips.service.ts:2122` — `forceStatus` has no optimistic lock. **Fix:** optional `expectedStatus` param → `WHERE status = expected` when supplied (admin escape hatch otherwise unchanged).
- **L6** `backend/service/src/reconciliation/reconciliation.service.ts:53–74` — fuel vs distance summed over mismatched scopes. **Fix:** scope fuel `quantity_liters` to the same completed/delivered trip windows as the distance sum.
- **L7** `backend/service/src/sync/sync.service.ts:471` — idempotency lookup not org-scoped. **Fix:** add `organization_id` to `sync_idempotency` (migration) and match it, or verify `result_data->>'organization_id'` before returning the cached row.
- **L8** `backend/service/src/sync/sync.service.ts:45` — `fraud_flags` client-writable. **Fix:** remove `fraud_flags` from `ALLOWED_COLUMNS.trips` (insert + update).
- **L9** `backend/service/src/messaging/aviz-notification.service.ts:71` — internal lookup lacks org filter (only reachable from the trusted processor today). **Fix:** add `organization_id` scoping for defense-in-depth.
- **L10** `packages/api/src/hooks/use-bale-loads.ts:9` — calls a nonexistent nested route. **Fix:** call `/api/v1/bale-loads?tripId=${tripId}` (or add the nested backend route).
- **L11** `packages/api/src/hooks/use-task-assignments.ts:9` — mis-typed camelCase (no live callers). **Fix:** alias backend columns or type the hook as raw rows.
- **L12** `apps/admin-web/src/app/api/client-log/route.ts:19` — unbounded rate-bucket map. **Fix:** sweep expired buckets (or bounded LRU).

## Group B — i18n (missing/hardcoded strings)
- **L13** `apps/admin-web/src/components/features/trips/TripList.tsx:137,142,143` — delete confirm + aria-label + tooltip hardcoded Romanian. **Fix:** add `trips_list.deleteConfirm`/`deleteAriaLabel` to `en.json`+`ro.json`, use `t()`.
- **L14** `apps/admin-web/src/app/super-admin/(dashboard)/devices/[id]/page.tsx:1062–1167` — SMS Gateway panel entirely un-i18n'd. **Fix:** add `superAdmin.devices.smsGateway.*` keys to both files; `useI18n()`; replace all literals.
- **L15** `apps/admin-web/src/components/shared/UserPresenceDot.tsx:109,137` — `aria-label` hardcoded English. **Fix:** add online/offline aria keys; use `t()`.

## Group C — a11y semantics
- **L16** `apps/admin-web/src/components/deposits/DepositFormModal.tsx:244,261` — toggles lack `role="switch"`/`aria-checked`/`aria-label`. **Fix:** add them (pattern in `accounts/page.tsx`, `settings/page.tsx`).
- **L17** `apps/admin-web/src/components/shared/DataTable.tsx:69,75` — sortable `<th>` not keyboard-accessible. **Fix:** wrap header in `<button>` (or `tabIndex`/`role`/`onKeyDown`) + `aria-sort`.
- **L18** `apps/admin-web/src/app/[slug]/(dashboard)/tracks/page.tsx:323` — legend toggle tooltip uses the same key for both states, no aria-label. **Fix:** add `tracks.hideTrack`/`showTrack`, use for `title` + `aria-label`.
- **L19** `apps/admin-web/src/app/[slug]/(dashboard)/tracks/page.tsx:345` — per-track remove reuses the "Clear all" label. **Fix:** add `tracks.removeTrack`, use for that button's `aria-label`.

## Group D — layout / UX
- **L20** `apps/admin-web/src/app/super-admin/(dashboard)/devices/page.tsx:1072` (+ `releases/page.tsx:322`) — `overflow-hidden` clips wide tables. **Fix:** `overflow-x-auto`.
- **L21** `apps/admin-web/src/components/features/trip-requests/AvizUploadModal.tsx:135` — replacing an existing aviz overwrites with no confirm. **Fix:** inline confirm when `existing` before `upload.mutate`.
- **L22** (paired with L14 area) — verify no other super-admin panels are un-i18n'd during the L14 sweep.

---

## Verification (Low tier)
- Mostly behavioral/visual: toggle a Romanian/English locale and confirm the L13–L15 strings translate; keyboard-tab to a sortable column header and sort with Enter/Space (L17); resize to tablet width and confirm the super-admin tables scroll (L20).
- L1: follow a `delivery_note` document download redirect end-to-end → 200 (not 401).
- L7/L8: DB changes replay clean (`./strawboss.sh db:migrate` scratch), `fraud_flags` no longer accepted from `/sync/push`.
- `./strawboss.sh typecheck all` green after each group.
