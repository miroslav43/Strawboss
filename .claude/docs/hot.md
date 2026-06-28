---
type: meta
title: "Hot Context — StrawBoss"
created: 2026-05-25
updated: 2026-06-28
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

- **Production on Docker Swarm (Jun 2026):** the app tier (`strawboss-backend` ×2, `strawboss-admin` ×1, `redis` ×1) now runs as a Swarm stack **`strawboss-app`** (`docker-stack.yml`) on the attachable overlay **`strawboss-net`**; **nginx + certbot stay on Docker Compose** (`docker-compose.yml`, those two only) as the shared reverse proxy for every domain on the VM, bridged to the overlay so it reaches the Swarm service VIPs. Deploys via `./strawboss.sh prod` are **health-gated rolling updates** (`order: start-first` + `failure_action: rollback`) → **zero downtime** (proven: 260/260 + 130/130 HTTP 200) plus 2-replica API redundancy. New CLI: `stack:status` / `stack:logs` / `stack:rollback` / `scale` ([[scripts]]); `stop` removes the stack but leaves the shared nginx. Backend made multi-replica-safe — graceful shutdown, boot advisory-lock backfill, capped PG pool ([[backend]]); admin needs `experimental.preloadEntriesOnStart:false` + `HOSTNAME=0.0.0.0` + a `/healthz` route ([[admin-web]]). **Single-node only** — `logs/`+`uploads/` are host-local bind mounts. Details + gotchas in [[infrastructure]].
- **Fleet management + OTA self-update (Jun 2026):** ~30 Device-Owner phones self-install APK updates. Super-admin manages a device registry + pushes/schedules OTA from `super-admin/(dashboard)/devices/` ([[admin-web]]); phones poll PUBLIC `POST /api/v1/fleet/checkin` ([[backend]] `fleet` module) and silently install via Device Owner `PackageInstaller`, deferred until idle unless `force_now` ([[mobile]]). Backend confirms `installed` only on versionCode proof. New tables in migration **00055** ([[database]]). ⚠️ **`apps/mobile/android/app/debug.keystore` must NEVER change** — rotating the signing key breaks OTA self-update for every fielded phone (same-signer requirement); it is pinned by SHA-256 and CI-guarded (`scripts/verify-keystore.sh`, `.githooks/pre-commit`, `keystore-guard.yml` — see [[infrastructure]]).
- **Fleet Tailscale remote access (Jun 2026):** super-admin toggles Tailscale per phone for remote `adb` debugging — the Device-Owner app configures the official Tailscale app via MDM (and silently auto-installs it from a hosted APK if missing), joining tailnet `tail2b4c34.ts.net`. Red/green dot fed by a HOST-side `./strawboss.sh fleet:tailscale-sync` (systemd timer — the container can't reach the tailnet). Per-device **ephemeral** keys minted via a Tailscale OAuth client (no shared-key broadcast); auth key/OAuth live in the DB `app_settings` (never in repo). Nickname (`devices.name`) shown first + used as the Tailscale hostname. `./strawboss.sh fleet:tunnel <hostname>` opens adb over the tailnet (ADB-TCP needs a one-time per-phone enable). Migrations **00056/00057** ([[database]], [[backend]], [[mobile]], [[scripts]], [[infrastructure]]).
- **Local release builds auto-register (Jun 2026):** `./strawboss.sh mobile-build-local release` bumps version, names the APK `strawboss-v<ver>-vc<code>-<gitshort>.apk`, archives it under `uploads/apks/`, registers it in `app_releases` as published (psql), and prunes to the newest 10 — so it shows in the super-admin Releases list, sorted newest-first ([[scripts]], [[admin-web]]).
- **Presence + auth persistence (Jun 2026):** Machine-bound operators now stay **online while backgrounded** — `POST /location/report` touches `users.last_seen_at` via `ProfileService.touchLastSeen` (Layer 1, [[backend]]); non-GPS roles use a native `PresenceService` keep-alive foreground service on device-owner builds (Layer 2, [[mobile]]). Mobile Supabase session now **persists across restarts** via a SecureStore-backed adapter (`apps/mobile/src/lib/secure-store-adapter.ts`, wired through `createClient` in [[packages-api]]); the forced logout on a failed profile fetch was removed — session is lost only on explicit logout.
- **Recent merge (855fa58):** Integrated Plan B's harvest helper into trip lifecycle — check `packages/domain` for new harvest-related exports and `backend/service/src/trips/` for updated transition logic.
- **Pending docs work:** `hot.md` (this file), `log.md`, and wikilink cross-references across docs are being set up. `.vault-meta/` and `scripts/` (DragonScale tooling) coming next.

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
| DB migrations | `supabase/migrations/` (00001–00057) |
| RLS policies | `supabase/migrations/` — see [[database]] |
| Fleet / OTA self-update | `backend/service/src/fleet/` + `apps/mobile/src/lib/device-checkin.ts` + `super-admin/(dashboard)/devices/` |
| OTA signing keystore (pinned) | `apps/mobile/android/app/debug.keystore` — guarded, see [[infrastructure]] |
| Fleet Tailscale remote access | `backend/service/src/fleet/` + `apps/mobile/src/lib/device-checkin.ts` + `scripts/10-fleet.sh` + `deploy/systemd/` |
| React Query hooks | `packages/api/src/hooks/` (43 files) |
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
