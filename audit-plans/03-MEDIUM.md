# 🟡 MEDIUM — 12 tasks

> Part of the StrawBoss audit. See [`README.md`](./README.md) for full context, root causes (R1–R6), and the C5 keystore decision.
> Build order for shared-package edits: `types → validation → ui-tokens → domain → api → backend/admin-web`. Typecheck after each task: `./strawboss.sh typecheck all` (you run the UI build).

**Theme:** input allowlists, check-then-act races, OTA self-heal, error UI, reconciliation correctness, and mobile role/badge UX. **M8 and M12 require DB migrations.**

---

## M1 · Allowlist signature/specimen URLs
- **Files:** `packages/validation/src/dtos/trip-transition.schema.ts:12,45,61,122`; `packages/validation/src/schemas/profile.schema.ts:13`; persist sites `trips.service.ts`, `profile/profile.service.ts:167–169`; render `apps/admin-web/src/components/shared/SignatureDisplay.tsx:42–46`
- **Steps:** replace `z.string().min(1)` with an allowlist (starts with `/api/v1/uploads/signatures/`|`/specimens/` **or** matches `data:image/(png|jpeg);base64,…`) — reuse `CmrService.SIGNATURE_URL_PATTERN` as a shared helper. Enforce server-side on persist; sanitize in `SignatureDisplay`. Rebuild `@strawboss/validation`.
- **Acceptance:** an external `https://…` signature value is rejected (400) and never reaches `<img src>`.

## M2 · Atomic status guard on `setDestination`
- **Files:** `backend/service/src/trips/trips.service.ts:2747–2781`
- **Steps:** add `AND status = ANY(ARRAY['planned','loaded']::trip_status[])` to the UPDATE; check affected rows; throw "Trip status changed concurrently" on 0 (mirror other transitions).
- **Acceptance:** destination can't change after depart.

## M3 · OTA: re-download on install failure + verify SHA early
- **Files:** `apps/mobile/src/lib/device-checkin.ts:633–717`
- **Steps:** on any install failure clear `mirror.localUri` and `FileSystem.deleteAsync` the file before persisting `failed`; verify SHA-256 immediately after `downloadAsync` (retry at download step, not install).
- **Acceptance:** a corrupted download self-heals on the next check-in instead of burning all 3 attempts.

## M4 · Trust `X-Real-IP` for rate limiting
- **Files:** `apps/admin-web/src/app/api/client-log/route.ts:21`; also `backend/service/src/trip-requests/pin-throttle.guard.ts:22`
- **Steps:** replace "first `X-Forwarded-For` hop" with `x-real-ip` (nginx sets it, always overwritten) or the **last** XFF hop. (nginx uses `$proxy_add_x_forwarded_for` → attacker controls the first value.)
- **Acceptance:** spoofed `X-Forwarded-For` no longer resets the per-IP counter.

## M5 · Surface fetch errors on list pages (R5)
- **Files:** `farms/page.tsx:304`, `deposits/page.tsx:169`, `parcels/page.tsx:467`, `messages/page.tsx:42`, `tasks/page.tsx:100`
- **Steps:** destructure `isError` and render the existing `t('*.loadError')` banner before the empty-state branch (pattern already in `trip-requests`/`machines`/`accounts`).
- **Acceptance:** a forced API failure shows an error banner, not "no items".

## M6 · Add error UI to plan boards
- **Files:** `apps/admin-web/src/components/features/tasks/machine-plan/MachinePlanBoard.tsx:552`; `TruckPlanBoard.tsx:83`
- **Steps:** add an `isError` branch with a retry action, mirroring `DailyPlanBoard.tsx`.
- **Acceptance:** failed fetch shows an error, not an empty board.

## M7 · Lock geofence enter/exit dedup
- **Files:** `backend/service/src/geofence/geofence.service.ts:330–596`
- **Steps:** wrap read-last-event + insert + side-effects in `pg_advisory_xact_lock(hashtext(machine|assignment|geofence))` (pattern already used in `trips.service.ts`), or add a partial unique index rejecting a second consecutive same-type event and skip the duplicate push on conflict.
- **Acceptance:** with 2 backend replicas, a single crossing fires one event/push.

## M8 · Separate delivered vs loaded bale count (needs migration)
- **Files:** `backend/service/src/reconciliation/reconciliation.service.ts:36–45`; trip flow `trips.service.ts` (confirmDelivery/complete); new migration
- **Steps:** persist a `delivered_bale_count` distinct from `bale_count`, decremented by `deteriorated_bales_count` on the driver delivery path; sum that in `reconcileBalesForParcel`.
- **Acceptance:** `deliveredVsLoadedDiff` can be non-zero for non-depot trips with damage/loss.

## M9 · Real `clientVersion` on sync retries
- **Files:** `apps/mobile/src/sync/push.ts:297`; correlate with backend idempotency `sync.service.ts:470–489`
- **Steps:** increment a per-entry attempt/content version (or hash the payload) on every `updatePayload`/repair-requeue; send it as `clientVersion` so a corrected retry isn't masked as a duplicate.
- **Acceptance:** a receipt/machine-id backfill retry updates the server row.

## M10 · Non-field roles on mobile get a clear screen
- **Files:** `apps/mobile/app/_layout.tsx:70–76,518`; `/(tabs)/index.tsx`
- **Steps:** add an explicit check for `dispatcher`/`admin`/`super_admin` → route to a "managed from the web dashboard" screen (or block mobile login with a clear message) instead of the operator fallback.
- **Acceptance:** an admin logging into mobile sees a meaningful message, not a perpetual "no machine assigned".

## M11 · Distinguish failed vs pending transition badge
- **Files:** `apps/mobile/src/components/shared/PendingTransitionBadge.tsx:10`; call sites `app/trip/[tripId].tsx:230`, `EnhancedDeliveryFlow.tsx:380`
- **Steps:** pass the actual `sync_queue` status; add a `failed` variant (distinct color/label + tap-to-retry) instead of relying only on `has_pending_transition`.
- **Acceptance:** a failed transition is visually distinct and actionable.

## M12 · Corrective migration for `user_role()` (plausible — verify first)
- **Files:** new `supabase/migrations/000NN_fix_user_role_fn.sql`; ref `00009_roles_gps.sql:29`, `00052`/`00053`
- **Steps:** first verify live health: `SELECT pg_catalog.format_type(prorettype,NULL) FROM pg_proc WHERE proname='user_role';`. If stale, ship an idempotent migration recreating `public.user_role()` to **return `text`** (`current_setting('request.jwt.claims',true)::json->'app_metadata'->>'role'`), recreating dependent policies in the same script; `DROP TYPE IF EXISTS user_role_old CASCADE` once unused. Test against a scratch DB replay.
- **Acceptance:** full migration set replays clean on an empty DB; RLS for dispatcher/geofence_maker/super_admin/depot_manager evaluates without error.

---

## Verification (Medium tier)
- External `https://` signature value → 400; only internal/`data:` URLs persist and render.
- `setDestination` after a concurrent depart → "status changed concurrently" (no silent change).
- Spoofed `X-Forwarded-For` no longer resets the `/api/client-log` counter.
- Force an API failure on farms/deposits/parcels/messages/tasks + plan boards → error banner, not empty state.
- Two-replica geofence crossing → one event/push.
- `./strawboss.sh db:migrate` (M8/M12) replays clean on a scratch DB; `./strawboss.sh typecheck all` green.
