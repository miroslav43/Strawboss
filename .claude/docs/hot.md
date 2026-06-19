---
type: meta
title: "Hot Context — StrawBoss"
created: 2026-05-25
updated: 2026-06-19
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
./strawboss.sh logs:flow    # Watch business-event log
./strawboss.sh status       # Full dashboard
```

## Where Things Live

| Concern | Location |
|---|---|
| Trip state machine | `packages/domain/src/trip-machine/` |
| Sync push/pull | `backend/service/src/sync/` + `apps/mobile/src/sync/` |
| DB migrations | `supabase/migrations/` (00001–00043) |
| RLS policies | `supabase/migrations/` — see [[database]] |
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
