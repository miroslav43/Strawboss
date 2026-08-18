---
type: meta
title: "Hot Context — StrawBoss"
created: 2026-05-25
updated: 2026-08-18
tags: [meta, hot, context]
status: developing
---

# Hot Context — StrawBoss

Read this first every session. ~500 words covering what's load-bearing right now.

## Five Invariants (Never Break These)

1. **Trip state machine is authoritative.** All ten transition endpoints call `getAvailableTransitions()` from `@strawboss/domain` before mutating. Never bypass it. Source: `packages/domain/src/trip-machine/`.

2. **Multi-iteration trips (Plan C).** A completed trip can spawn a next iteration via `nextIterationDtoSchema`. Loader recall (`loaderRecallResponseSchema`) drives the "is loader coming back?" fork. Backend handles this in `backend/service/src/trips/`.

3. **Idempotency everywhere in sync.** Every sync mutation carries a UUID `idempotencyKey`. Server checks `sync_idempotency` table before applying. Mobile resets `in_flight` → `pending` on crash recovery. Never process the same mutation twice.

4. **Organization scoping on every query.** Every backend query that touches multi-tenant data must filter by `organization_id`. RLS is the last defense — the backend must also enforce it at query time. Missing org filter = cross-org data leak.

5. **Soft deletes only.** No hard deletes anywhere. All mutable entities have `deleted_at`. Sync pull queries exclude `WHERE deleted_at IS NULL`. Never `DELETE FROM` any entity table in app code.

## What's Changing Now

- **Hungarian (`hu`) as a third interface language (Aug 2026):** SSOT is `packages/types/src/locale.ts` — `SUPPORTED_LOCALES = ['ro','en','hu']`, replacing a set duplicated 17 places. Zero DB migration: `users.locale` is unconstrained `TEXT`, guarded only by the `z.enum(SUPPORTED_LOCALES)` in `@strawboss/validation` (deliberate — a CHECK would turn every future language into a migration and a clean 400 into a raw 500). Backend gets its FIRST i18n runtime (`backend/service/src/common/i18n/`, `tServer(locale, key, params)`) — push, PDF labels, and (via a parallel `messageTemplates[kind][locale]`) email/SMS are all now localized; `RequestUser.locale` rides the existing auth-guard cache at zero extra query cost. **Adding a 4th language = one SSOT entry + three new catalog files** (`backend/.../catalogs/<code>.ts`, `admin-web/messages/<code>.json`, `mobile/src/i18n/<code>.ts`) — every `Record<Locale, …>` assembly point refuses to compile until the catalog exists. **Verification trap: the compiled zod enum is not `grep`-able** (the array is imported, never inlined) — verify via `dist/` + `safeParse()`, not source search. **Deploy order is backend → admin-web → mobile APK**, reversed breaks any account that switches to `hu` with a 400. See [[packages-types]], [[backend]], [[admin-web]], [[mobile]].
- **GPS track noise, iteration 2 (Aug 2026):** the residual "spider web" on Tracks came from a second source: when a phone's location task dies (Android 14+ FGS-restart hole), the 60s presence check-in's best-effort fix (`getBestEffortPosition`, deliberately last-known + Balanced/network-quality) is all that flows, and a 4km hop at 60-300s spacing reads as a "legal" 118 km/h -- invisible to the kinematic cleaner. Permanent fix: `machine_location_events.source` (`'task'`/`'checkin'`, migration `00097`) tags every fix at ingest; tracks + every distance report now exclude `source='checkin'`. Read-side (history + pre-vc56 APKs): a slow-machine speed cap plus an opt-in skeleton-consistency pass (loaders/balers only, **not** trucks). **Accuracy ceilings were measured and rejected a second time** -- never gate a drawn track on accuracy directly. Ingest also clamps `heading_deg`/`speed_ms` (52 batch-insert 500s from `numeric field overflow`). Mobile vc56/1.0.52 stamps the tag + drops check-in fixes past 2km error. ([[backend]], [[mobile]], [[database]])
- **Per-organization feature toggles, 57/57 wired (Jul 2026, settled):** a super_admin can switch product modules/features off per tenant — a **product gate, never a security gate**. Registry SSOT `packages/types/src/features.ts`; overrides in `organizations.feature_overrides` (migration `00093`); enforced by `FeaturesGuard`/`@RequireFeature`. **Renaming a key silently re-enables it for every org that had it off — add and deprecate, never rename.** Full system in [[feature-toggles]].
- **Transportator role + Curse/Curse Aux merge (Jul 2026):** new web-only account type `transportator` — external hauler with a read-only aux-trip ledger (`trip_requests.created_by_user_id`) plus an authenticated beneficiary request form and aviz/CMR upload; auto-generated "comandă" (transport order) PDF. The old `/trip-requests` page was folded into `/trips` (Curse + Curse Aux, one page, two ledgers, realtime on `trip_requests`); old route now redirects. `AuxStage`/`composeAuxStage()` (`packages/domain`) is the **single source of truth** for an aux transport's status — never derive it ad hoc from `trip_requests.status` or `trips.status` alone. Field-sourced pickup (`trip_requests.source_parcel_id`) is now a valid alternative to a depot pickup (XOR-enforced). Migration 00087. ([[admin-web]], [[backend]], [[database]], [[packages-types]], [[packages-domain]], [[packages-validation]])
- **P0 cross-org fixes, closed (Jul 2026):** a second organization could not create ANY trip — `trip_number` was globally unique instead of per-org (migration 00086, fixed) — and CMR's `public_sign_token` was leaking on `GET /trips` (fixed). Parcel references also got cross-org composite-FK hardening as defense-in-depth (migration 00091). Tracked as CR-9/CR-10/H-18, ✅ FIXED in `.claude/issues/security-audit-2026-05-11.md`. ([[database]], [[backend]])
- **Delivery flow simplified (Jul 2026):** driver signature dropped from `/depart`; receiver signature dropped from the depot delivery flow; a self-confirmed depot can record a delivery without weighing (`scaleBroken`, nullable weights). Depot inventory now correctly subtracts outbound stock (was inbound-only). ([[mobile]], [[backend]])
- **R8/Proguard headless-loader fix (Jul 2026):** root cause of the fleet always-on incident — enabling R8 silently stripped Expo's reflection-loaded headless JS app loader, so background JS never ran on any phone. Fixed via `withHeadlessProguard.js` keep rules (minify stays ON). **Never re-enable/change Proguard rules without this plugin's `-keep` intact.** ([[mobile]])
- **Stale-plan sweep + assignment-aware loader board (Jul 2026):** a new daily 00:15 job auto-cancels abandoned own-fleet `planned` trips (aux trips left alone — they're a different lifecycle, see AuxStage above). The loader home card now uses a dedicated `loader-board` endpoint keyed on `trips.loader_id` (assigned/nearby/presence), replacing the old `useTrucksAtLoader`. ([[backend]], [[mobile]], [[admin-web]])
- **CMR scan for auxiliary loads (Jul 2026):** an external driver on an aux load photographs the paper CMR at drop-off — mobile scans it, builds a PDF on-device, uploads via `CmrScansModule`; admin can also override-upload. `document_type` value `cmr_scan` (migration 00083, distinct from the backend-generated `cmr`). ([[backend]], [[mobile]], [[admin-web]], [[database]])
- **Production on Docker Swarm (Jun 2026):** the app tier (`strawboss-backend` ×2, `strawboss-admin` ×1, `redis` ×1) runs as Swarm stack **`strawboss-app`**, nginx+certbot stay on Compose as the shared reverse proxy. Deploys via `./strawboss.sh prod` are **health-gated rolling updates** → zero downtime. New CLI: `stack:status`/`stack:logs`/`stack:rollback`/`scale` ([[scripts]]). **Single-node only** — `logs/`+`uploads/` are host-local bind mounts. Details in [[infrastructure]].
- **Fleet management + OTA self-update (Jun 2026):** ~30 Device-Owner phones self-install APK updates via `POST /api/v1/fleet/checkin` ([[backend]] `fleet` module) + Device Owner `PackageInstaller` ([[mobile]]). ⚠️ **`apps/mobile/android/app/debug.keystore` must NEVER change** — rotating it breaks OTA for every fielded phone; pinned by SHA-256, CI-guarded ([[infrastructure]]).
- **Fleet Tailscale remote access (Jun 2026):** super-admin toggles Tailscale per phone for remote `adb`; tailnet `tail2b4c34.ts.net`; ephemeral OAuth-minted keys; dot fed by a HOST-side systemd timer (container can't reach the tailnet). ([[database]], [[backend]], [[mobile]], [[scripts]], [[infrastructure]])

## High-Friction Places

- **Sync service (`backend/service/src/sync/sync.service.ts`):** Column allowlist + `sql.raw()` — always use `validateColumnName()` before dynamic column access.
- **Trip transitions:** Zod schema per transition step (see [[packages-validation]] `dtos/trip-transition.schema.ts`). Frontend and backend must use the same schema.
- **Offline-first mobile:** Local SQLite writes go through outbox → `sync_queue`. Never write directly to the server from mobile without an idempotency key.
- **Build order:** `types → validation → ui-tokens → domain → api → backend/admin-web`. Shared packages must be compiled first. Use `./strawboss.sh build packages` before running apps.

## Quick Commands

```bash
./strawboss.sh dev          # Start local dev (ports 3000 admin, 3001 API)
./strawboss.sh build packages  # Rebuild all shared packages
./strawboss.sh db:migrate   # Apply pending migrations
./strawboss.sh prod         # Build + zero-downtime rolling deploy (Swarm app tier)
./strawboss.sh stack:status # Production app-tier health (replicas + tasks)
./strawboss.sh logs:flow    # Watch business-event log
./strawboss.sh status       # Full dashboard
```

## Where Things Live

| Concern | Location |
|---|---|
| Trip state machine | `packages/domain/src/trip-machine/` |
| Sync push/pull | `backend/service/src/sync/` + `apps/mobile/src/sync/` |
| DB migrations | `supabase/migrations/` (00001–00097) |
| GPS noise / route cleaning | `backend/service/src/common/gps-noise.ts` + `route-cleaning.ts` |
| RLS policies | `supabase/migrations/` — see [[database]] |
| Fleet / OTA self-update | `backend/service/src/fleet/` + `apps/mobile/src/lib/device-checkin.ts` + `super-admin/(dashboard)/devices/` |
| OTA signing keystore (pinned) | `apps/mobile/android/app/debug.keystore` — guarded, see [[infrastructure]] |
| Fleet Tailscale remote access | `backend/service/src/fleet/` + `apps/mobile/src/lib/device-checkin.ts` + `scripts/10-fleet.sh` + `deploy/systemd/` |
| Auxiliary trip lifecycle (AuxStage) | `packages/domain/src/rules/aux-stage.ts` — see [[packages-domain]], [[architecture]] |
| Locale SSOT (`ro`/`en`/`hu`) | `packages/types/src/locale.ts` — server i18n in `backend/service/src/common/i18n/`, see [[packages-types]] |
| React Query hooks | `packages/api/src/hooks/` (28 files) |
| Admin pages | `apps/admin-web/src/app/` |
| Mobile screens | `apps/mobile/src/app/` |

## Pointers to Full Docs

- Architecture overview → [[architecture]]
- Backend (NestJS + Drizzle + BullMQ) → [[backend]]
- Database (migrations, RLS, PostGIS) → [[database]]
- Mobile (Expo offline-first) → [[mobile]]
- Sync protocol (push/pull/idempotency) → [[sync-protocol]]
- Admin web (Next.js, TanStack Query) → [[admin-web]]
- Domain package (state machine, fraud) → [[packages-domain]]
- Per-org feature toggles (registry, guard, console) → [[feature-toggles]]
