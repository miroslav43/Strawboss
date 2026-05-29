---
title: Loader recall prompt + truck-idle admin alert — repair (req #14)
date: 2026-05-29
status: design
scope: P0 + P1a + P1b + P2 (P3 resolved as side-effect)
area: mobile (loader), backend (trips/notifications), db migration
---

# Loader recall prompt + truck-idle admin alert — repair (req #14)

## Requirement #14 (verbatim)

> La camioane după ce o descărcat să primească loader-ul o notificare dacă-l
> recheamă sau nu pe camion la el. Dacă nu-l cheamă, și un truck e idle, să
> primească admin notificare.

Translation: after a truck unloads, the loader gets a notification asking
whether to recall the truck back to him. If he declines, and a truck is idle,
the admin gets a notification.

## Current state (as built)

The **backend** wiring for #14 is complete:

- `trips.service.ts` `complete()` (≈L899-946) — "Plan C multi-iteration hook":
  if the source parcel still has bales **and** `loader_operator_id` is set,
  calls `notificationsService.sendTruckUnloadedLoaderPrompt(loaderId, tripId, truckCode)`.
- Push payload: `type: 'loader_recall_prompt'`, `actions: ['recall_yes','recall_no']`
  (`notifications.service.ts:462-478`).
- Loader answers via `POST /notifications/loader-recall-response`
  (`notifications.controller.ts:137-150`): `recall=true → createNextIteration`,
  `recall=false → recordNoRecall`.
- `createNextIteration` (`trips.service.ts:996-1109`) — advisory-locked per course,
  mints `iteration_index = MAX+1`, copies truck/driver/loader/destination,
  appends `[recall_yes:...]` marker to the source trip's `delivery_notes`.
- `recordNoRecall` (`trips.service.ts:1116-1135`) — appends `[recall_no:...]` marker.
- `truck-idle.processor.ts` (BullMQ, every 5 min) — alerts admins/dispatchers when
  a truck's last completed trip is older than the threshold (default 30 min),
  no open iterations, parcel has remaining bales, no active task assignment;
  60-min dedup on unacknowledged `truck_idle` alerts.

**The chain breaks entirely on the client.** Requirement #14's core
interaction (loader decides) does not function in practice.

## Confirmed problems

### 🔴 P0 — Loader physically cannot answer the prompt (dead end-to-end)

Three independent breaks combine:

1. **Push is never persisted locally.** `resolveTypeAndCategory`
   (`apps/mobile/src/lib/notification-handler.ts:40-109`) has **no case** for
   `loader_recall_prompt` → falls to `default: return null` → `handleIncomingPush`
   L119-120 `if (!resolved) return;`. The push is dropped before insertion into
   the SQLite `notifications` table. (The enum value *exists* in
   `apps/mobile/src/types/notifications.ts:34` — only the switch case is missing.
   The file header comment even warns: "unrecognised types are dropped on the
   floor by resolveTypeAndCategory".)
2. **The UI hook is orphaned.** `useLoaderRecallPrompt`
   (`apps/mobile/src/hooks/useLoaderRecallPrompt.ts`) — which would render the
   Da/Nu card — is **never imported** by any screen/component.
3. **No native action buttons.** No `setNotificationCategoryAsync` is registered,
   so the `actions: ['recall_yes','recall_no']` payload is inert — the OS shows
   only a plain banner.

Result: the entire backend recall machinery is unreachable from the loader's
phone. `truck_idle` push has the same problem #1 (no switch case) — less severe
for admins because the alert *is* persisted server-side in the `alerts` table and
shown in admin-web, but the admin's **mobile feed** never shows it.

### 🟠 P1a — Recall response is not idempotent → duplicate iterations

`/loader-recall-response` with `recall=true` → `createNextIteration` does **not**
check whether the trip already produced an iteration. The advisory lock
*serializes* but does not *dedupe* (`MAX(iteration_index)+1`). Two calls
(double-tap, network retry, two logged-in devices) create **two** new iteration
trips = truck recalled twice. Likewise `recall=false` can append multiple
`[recall_no:]` markers. The `alreadyAnswered` guard lives only in `complete()`
(to suppress re-prompts), not in the mutation endpoint.

### 🟠 P1b — `recordNoRecall` and the idle processor are disconnected

`recordNoRecall`'s doc comment (`trips.service.ts:1112-1115`) says the
`[recall_no]` marker exists so the truck-idle processor "can later decide whether
to alert admins". But `truck-idle.processor.ts` **selects `delivery_notes`
(L98) and never uses it.** The idle alert fires purely on time threshold +
remaining bales + no open iterations + no active task — regardless of whether the
loader said "no" or simply never answered. So:
- `delivery_notes` in the query is dead data, and
- the documented intent (act on explicit decline) is not implemented, and
- an explicit "NU" still waits up to 30 min before the admin is told, even
  though we already *know* the truck is free.

### 🟡 P2 — Weak authorization on the recall endpoint

`/loader-recall-response` is guarded by `@Roles('admin','loader_operator')` but
does **not** check that the caller is the trip's `loader_operator_id`. Any
loader_operator in the org can recall/decline any truck for any trip.

### ⚪ P3 — Fragile recall markers (resolved as side-effect)

Recall decisions are stored as free-form substrings in `delivery_notes`
(`[recall_yes:id:ts]`, `[recall_no:id:ts]`); the guard uses
`.includes('[recall_no:')`, which a real free-text delivery note could trip.
Replaced by a structured column (see B).

## Design decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Loader prompt UX | **Blocking overlay** like `GeofenceOverlay`, mounted in `(loader)/_layout.tsx` |
| Native push action buttons | **No** this round (in-app only) |
| Admin alert on explicit "NU" | **Immediate**, plus keep 30-min threshold for "no answer" |
| Idempotency mechanism | **Migration** (`recall_decision` + `recall_decided_at`) — also fixes P3 |
| P2 authorization fix | **Included** this round |

## Changes

### Part A — P0: loader can answer in-app (mobile only)

**A1. Persist the push.** `apps/mobile/src/lib/notification-handler.ts` —
add switch cases in `resolveTypeAndCategory`:
- `loader_recall_prompt` → `{ type: loader_recall_prompt, category: trip_state, severity: warning }`
- `truck_idle` → `{ type: truck_idle, category: system, severity: warning }`
- `trip_next_iteration` → `{ type: trip_next_iteration, category: trip_state, severity: info }`

(Enum values already exist in `apps/mobile/src/types/notifications.ts`. Optional
housekeeping: re-sync `packages/types/src/entities/mobile-notification.ts`, which
has drifted and lacks these values — not required for the fix since the handler
imports the mobile copy.)

**A2. Live refresh.** `apps/mobile/src/hooks/useLoaderRecallPrompt.ts` —
subscribe to `subscribeToNotificationChanges(load)` (from `notification-handler.ts`)
inside a `useEffect` so the overlay appears the instant a push lands, not only on
mount. Unsubscribe on unmount.

**A3. Overlay component.** New `apps/mobile/src/components/features/loader/LoaderRecallOverlay.tsx`,
mirroring `GeofenceOverlay` (full-screen modal, two large buttons). Props:
`prompt: LoaderRecallPromptState | null`, `pending: boolean`,
`onRespond(recall: boolean)`. Title "Camion descărcat", body
"Camionul {truckCode} a descărcat. Îl chemi înapoi?", buttons DA / NU.

**A4. Mount.** `apps/mobile/app/(loader)/_layout.tsx` — call `useLoaderRecallPrompt()`
and render `<LoaderRecallOverlay … />` next to `<GeofenceOverlay />`.

**A5. Banner tap.** Ensure the existing notification-response listener brings the
loader into `(loader)` where the overlay is already shown. No new routing logic if
the overlay is mounted at the layout level (it shows whenever an unread prompt
exists). Confirm during implementation.

### Part B — P1a + P2 + P3: idempotent, authorized response

**B0. Migration** `supabase/migrations/00048_trip_recall_decision.sql` (idempotent,
follows `strawboss-new-migration`):
- `ALTER TABLE trips ADD COLUMN IF NOT EXISTS recall_decision text` with a CHECK
  constraint in (`'recalled'`, `'declined'`) or NULL.
- `ALTER TABLE trips ADD COLUMN IF NOT EXISTS recall_decided_at timestamptz`.
- Partial index on `(truck_id) WHERE recall_decision = 'declined'` if needed by C.
- Add to Drizzle schema / `packages/types` Trip interface + Zod where surfaced.

**B1. `createNextIteration`** (recall=true path): inside the existing
advisory-locked transaction, after `FOR UPDATE` on the current trip, reject when
`recall_decided_at IS NOT NULL` (throw `ConflictException` / 409 with a clear
message); otherwise proceed and set `recall_decision='recalled', recall_decided_at=NOW()`
on the source trip (replacing the `delivery_notes` marker write).

**B2. `recordNoRecall`** (recall=false path): make idempotent — set
`recall_decision='declined', recall_decided_at=NOW()` only when not already
decided. If already `'declined'` → return ok (no-op). If already `'recalled'` →
reject (409). Keep the `status='completed'` guard.

**B3. `complete()` hook**: replace the `deliveryNotes.includes('[recall_...')`
check with `recall_decided_at IS NULL` (fixes P3).

**B4. P2 authorization** in `notifications.controller.ts` `loaderRecallResponse`:
before mutating, verify the caller is the trip's `loader_operator_id` **or** has
role `admin`. Reject others with `ForbiddenException`. (Service-level check
preferred so it is enforced regardless of caller.)

### Part C — P1b: immediate admin alert on explicit "NU"

**C1.** In `recordNoRecall`, after marking `declined`: determine whether the truck
is genuinely idle now — source parcel has remaining bales (`computeRemainingBalesOnParcel`)
and no open iterations on the course. If idle, immediately call
`alertsService.createTruckIdleAlert(...)` + `notificationsService.sendTruckIdleAdminAlert(...)`,
respecting the same 60-min dedup the processor uses (skip if an unacknowledged
`truck_idle` alert exists for the truck). Use a distinct message/reason:
"Loaderul a refuzat rechemarea — camionul {cod} e liber." (e.g. `data.reason = 'loader_declined'`).

**C2.** `truck-idle.processor.ts` unchanged for the "no answer" path (30-min
threshold still fires). Optional: read `recall_decision` to enrich the alert
message, but not required.

## Testing strategy

- **Backend unit/e2e:**
  - `recordNoRecall` twice → single `declined`, single immediate alert (dedup holds).
  - `createNextIteration` twice on same trip → second call 409, exactly one iteration.
  - recall=true then recall=false (and vice-versa) → second rejected.
  - `loaderRecallResponse` by a non-assigned loader → 403; by assigned loader / admin → ok.
  - idle processor: declined trip with remaining bales already alerted immediately →
    processor dedups; trip with no answer after threshold → processor alerts.
- **Mobile:** simulate `loader_recall_prompt` push (existing `/notifications/simulate-push`
  admin endpoint) → row inserted in SQLite, overlay renders, DA/NU POST round-trips,
  overlay dismisses, notification marked read.
- **Typecheck** after each layer (`./strawboss.sh typecheck`).

## Out of scope (follow-ups)

- Native push action buttons (lock-screen DA/NU) — deferred by decision.
- Re-syncing `packages/types` `MobileNotificationType`/`Category` with the mobile
  copy (drift cleanup).
- Push delivery retry / server-side "pending decision" record if the push is lost.
- `useLoaderRecallPrompt` showing only the latest unread prompt (multiple stacked
  trucks) — acceptable for now; note if multiple trucks can prompt the same loader.

## Build order

1. Migration (B0) → Drizzle schema / types.
2. Backend service + controller (B1–B4, C1).
3. Mobile (A1–A5).
4. Typecheck, tests, manual sim.
