# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Four primary commands cover everything:

```bash
./strawboss.sh setup   # First-time: install deps, copy .env, migrate DB, build packages
./strawboss.sh dev     # Start local dev (localhost:3000 admin, localhost:3001 API + Redis)
./strawboss.sh prod    # Build Docker images + start production (https://nortiauno.com)
./strawboss.sh stop    # Stop dev processes and all Docker services
```

Lower-level commands for targeted work:

```bash
./strawboss.sh build [target]      # Build specific package/app (packages|backend|admin|all)
./strawboss.sh typecheck [target]  # Type-check one or all packages
./strawboss.sh lint                # ESLint across all packages
./strawboss.sh clean               # Remove dist/ and .next/
./strawboss.sh db:migrate          # Apply supabase/migrations/*.sql via psql
./strawboss.sh db:seed             # Run supabase/seed.sql
./strawboss.sh ssl:init            # Issue Let's Encrypt cert (first prod deploy only)
./strawboss.sh status              # Show build + Docker status
./strawboss.sh logs                # tail -f today's combined web log (JSON lines)
./strawboss.sh logs:error          # tail today's logs/web/error/
./strawboss.sh logs:flow           # tail today's logs/web/flow/ (business transitions)
./strawboss.sh logs:mobile         # tail today's logs/mobile/all/ (uploaded from devices)
./strawboss.sh logs:clean          # remove all files under logs/
pnpm brand:rasters                 # Regenerate mobile splash/icon + admin OG + app icon from branding/strawboss-tractor.svg
```

To run a script in a single package directly:
```bash
pnpm --filter @strawboss/backend dev
pnpm --filter @strawboss/admin-web build
```

**Build order matters.** Shared packages must be built before apps: `types → validation → ui-tokens → domain → api → backend/admin-web`. `setup` and `prod` handle this automatically.

## Architecture

### Monorepo Structure

- `packages/types` — `@strawboss/types`: Zero-dep TypeScript interfaces and enums. Every entity's canonical shape lives here. All IDs are UUID strings; all dates are ISO 8601 strings; all mutable entities have soft-delete via `deletedAt`.
- `packages/validation` — `@strawboss/validation`: Zod schemas mirroring every type. Provides `create*Schema` / `update*Schema` variants. Used for backend request validation and frontend form validation.
- `packages/domain` — `@strawboss/domain`: Pure business logic, no I/O. Contains the XState v5 trip state machine, fraud detection algorithms, bale/fuel reconciliation, and alert evaluation.
- `packages/api` — `@strawboss/api`: Shared data layer. Supabase client factory, typed fetch wrapper for the backend REST API (with JWT injection), centralized TanStack Query key factory, and 43 React Query hooks.
- `packages/ui-tokens` — `@strawboss/ui-tokens`: Design tokens (colors, spacing, typography). Exports a Tailwind CSS preset (`@strawboss/ui-tokens/tailwind-preset`) and React Native helpers (`@strawboss/ui-tokens/native`).
- `backend/service` — NestJS 11 + Fastify 5. All routes under `/api/v1/`. Uses Drizzle ORM with postgres.js for database access.
- `apps/admin-web` — Next.js 15 App Router, Tailwind CSS v4. Consumes `@strawboss/api` hooks and `@strawboss/ui-tokens` Tailwind preset.
- `apps/mobile` — Expo SDK 54 + Expo Router. Offline-first; all writes go to local SQLite + sync queue, synced to server when online.

### Trip State Machine

The trip is the core domain entity. Its lifecycle is enforced via XState v5 in `@strawboss/domain`:

```
planned → loading → loaded → in_transit → arrived → delivering → delivered → completed
                                                                    ↕
                                                                 disputed
```

All ten workflow transition endpoints on the backend (`POST /trips/:id/start-loading`, etc.) call `getAvailableTransitions()` from domain to validate before updating.

### Auth

Supabase Auth issues JWTs. The backend verifies them with `jose` (HMAC HS256 via `SUPABASE_JWT_SECRET`). Role enforcement uses `@Roles('admin', 'dispatcher')` decorator on controller methods. The database additionally enforces RLS policies per role (`admin`, `dispatcher`, `loader_operator`, `driver`).

### Background Jobs

BullMQ + Redis. Queues: `alert-evaluation` (15 min), `reconciliation` (hourly), `cmr-generation` (on-demand), `farmtrack-sync` (5 min), `sync-cleanup` (daily 02:00). Dev backend requires Redis — `strawboss.sh dev` starts it automatically from Docker.

### FarmTrack Integration

An abstract `IFarmTrackService` interface in the backend is implemented by `StubFarmTrackService` for development. When the real API is available, implement `RealFarmTrackService` with the same interface — no other code changes needed.

### Admin Dashboard Real-Time

`RealtimeProvider` subscribes to Supabase Realtime channels for `trips`, `task_assignments`, and `alerts`. On any postgres change event, it invalidates the matching TanStack Query cache key. No polling.

### Mobile Offline Sync

Local SQLite tables: `operations`, `trips`, `sync_queue`. Sync triggers: app foreground, network reconnect, after local write (2s debounce), periodic 60s. Push uploads binary files first (photos/signatures), then structured data via `POST /api/v1/sync/push`. Pull uses `POST /api/v1/sync/pull` with last `sync_version` per table. Every sync queue entry carries a UUID idempotency key — the server's `sync_idempotency` table prevents duplicate processing.

### Database

PostgreSQL on Supabase Cloud with PostGIS. Migrations in `supabase/migrations/` (00001–00008). Key design: soft deletes everywhere, generated columns for `net_weight_kg` and `odometer_distance_km`, `sync_version` bigint on trip/bale_load/fuel_log for delta sync, JSONB for `fraud_flags`/`metadata`/`payload`.

### File logging (Winston + mobile NDJSON)

- **Layout** (gitignored): `logs/web/{all,error,warn,info,debug,flow,http}/YYYY-MM-DD.log` and `logs/mobile/...` for payloads from the mobile app. Files rotate daily and **Winston** prunes files older than **7 days** (`maxFiles: '7d'`).
- **Backend** (`backend/service`): `AppLoggerModule` + `nest-winston`. Nest logs go to the `web` tree; `LoggingInterceptor` writes **http** lines (with `X-Request-Id`); `AllExceptionsFilter` logs **warn/error**; domain modules use **flow** for trips, task assignments, geofence, BullMQ jobs, etc. Set **`LOG_ROOT`** to an absolute path if the process cwd is not the monorepo (Docker: `/app/logs` via `docker-compose.yml` volume `./logs:/app/logs`).
- **Admin web**: `apps/admin-web/src/lib/server-logger.ts` writes to the same `logs/web/` tree. Browser logs are batched to **`POST /api/client-log`** (`client-logger.ts`, rate-limited). Optional **`onApiError`** on `ApiClient` (`packages/api`) records failed API calls.
- **Mobile**: `apps/mobile/src/lib/logger.ts` appends NDJSON under `DocumentDirectory/strawboss-logs/` with local 7-day cleanup (`cleanupOldMobileLogFiles`). After a **successful sync** (no errors), today's file is uploaded via **`POST /api/v1/logs/mobile`** and local day files are removed. Device logs also include GPS / geofence / sync **flow** lines.

### Environment

`NEXT_PUBLIC_*` vars are baked into the Next.js build at Docker build time (build args). In development, CORS allows `localhost:3000`; in production only `https://nortiauno.com` is allowed.

Optional: **`LOG_ROOT`** — root directory for `logs/web` and `logs/mobile` on servers (see `.env.example`).
