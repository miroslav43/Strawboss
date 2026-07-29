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

Local SQLite holds 13 tables (`src/db/schema.ts`) — beyond `operations` / `trips` / `sync_queue` it caches `parcels`, `delivery_destinations`, `task_assignments`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `notifications`, `sync_cursors`, `deposit_inventory_cache`.

**Sync triggers** (verify before relying on them — there is no foreground trigger, no post-write debounce, and no 60s timer):

| Trigger | Where | Cadence |
|---|---|---|
| WorkManager / BGTaskScheduler | `lib/background-sync.ts` | **15 min minimum**, OS-batched — the only automatic trigger for a role with no assigned machine |
| GPS piggyback | `lib/location.ts` (`maybePiggybackSync`) | 60–180 s, but **only for machine-assigned roles** (it rides the location task) |
| Network reconnect | `hooks/useSync.ts` | edge-triggered, and only when `pendingCount > 0` |
| Manual / after a write | `triggerSync()` | wherever a screen calls it explicitly — most do not |

A failed push backs off quadratically (30 s → 2 min → 4.5 min → 8 min…), and a backed-off row is invisible to `dequeue()` until its window opens.

Push uploads binary files first (photos/signatures), then structured data via `POST /api/v1/sync/push`. `parcel_create`, `delivery_destination_create`, `register_load`, `trip_transition` and `cmr_scan` bypass it for dedicated REST endpoints (`sync/push.ts`, `DIRECT_ENDPOINT_TYPES`). Pull uses `POST /api/v1/sync/pull` with the last `sync_version` per table. Every sync queue entry carries a UUID idempotency key — the server's `sync_idempotency` table prevents duplicate processing.

**Pull carries no geometry.** `PULL_COLUMNS.parcels` deliberately omits `boundary`/`centroid` (a raw projection would surface WKB hex). Map geometry reaches the phone *only* over the REST endpoints, which serialise via `ST_AsGeoJSON`. Anything writing the local `parcels` table from a pull payload must therefore leave `geometry` alone — see `ParcelsRepo.upsertFromPull`.

**The maps are local-first.** `useCachedParcels` / `useCachedDepots` render from SQLite and refresh from REST in the background, so a field drawn offline is on the map immediately. After any local write to `parcels` / `delivery_destinations`, invalidate `PARCELS_LOCAL_KEY` / `DEPOTS_LOCAL_KEY`.

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

## Claude Code Automations

The `.claude/` directory carries a custom automation setup that keeps the knowledge base in sync with the code and enforces project conventions.

### Skills (`.claude/skills/<name>/SKILL.md`) — invoke with `/<name>`

| Skill | Purpose |
|---|---|
| `strawboss-feature` | Add a new feature following project patterns |
| `strawboss-review` | Project-specific code review checklist |
| `strawboss-debug` | Debugging playbooks (sync, geofence, BullMQ, map, auth) |
| `strawboss-deploy` | Production deploy walkthrough |
| `strawboss-sync-docs` | Sync `.claude/` docs+agents with the current code — run after every feature |
| `strawboss-new-migration` | Scaffold an idempotent migration (RLS, indexes, sync_version) |
| `strawboss-bug-hunt` | Full multi-angle bug analysis (security web/mobile, logic, cross-layer contract drift, data integrity) — dispatches the review agents in parallel, then adversarially verifies each finding before reporting |

### Agents (`.claude/agents/`)

Domain specialists: `backend-agent`, `db-agent`, `devops-agent`, `frontend-agent`, `mobile-agent`. Review agents: `security-reviewer` (backend + DB/RLS), `web-reviewer` (admin-web XSS/i18n/React), `mobile-reviewer` (sync/offline/secrets), `logic-reviewer` (state machine, reconciliation, race conditions), `cross-layer-reviewer` (contract drift between backend/mobile/admin-web/packages — e.g. an enum renamed in `packages/types` without every consumer updated in the same PR). Plus `bug-finding-verifier` (adversarial verification pass `strawboss-bug-hunt` runs on every finding before reporting) and `docs-updater` (subagent form of `strawboss-sync-docs`, for large PRs).

### Plugin: `strawboss-farm` (`plugins/strawboss-farm/`)

An in-repo Claude Code plugin (local marketplace at `.claude-plugin/marketplace.json`) that **adds**, on top of the layer agents above, one specialist agent **per account type (role)** plus two skills. Install once: `/plugin marketplace add /srv/apps/Strawboss` then `/plugin install strawboss-farm` (or add to `enabledPlugins` in `.claude/settings.json`).

- **Per-role agents** (cross-layer, role-scoped — they orchestrate the layer agents): `role-driver`, `role-loader-operator`, `role-baler-operator`, `role-geofence-maker`, `role-depot-manager`, `role-dispatcher`, `role-admin`, `role-super-admin`. Each knows its mobile route group / web pages, backend `@Roles`, RLS, and trip-state transitions.
- **`/strawboss-account`** — router skill: develop/modify a feature for a given role; picks the matching `role-*` agent and applies the cross-layer per-role checklist.
- **`/strawboss-docs-sync`** — parallel docs sync: fans out `docs-updater` agents per doc-area (backend/db/mobile/web/packages/cross-cutting) in one message, then consolidates `log.md`/`_index.md`. High-throughput companion to the sequential `strawboss-sync-docs`.

### Hooks (`.claude/settings.json`)

- **PostToolUse / Edit**: auto-formats `.ts/.tsx/.js/.jsx/.json/.css` with Prettier.
- **PreToolUse / Edit**: warns (does not block) when editing `.env` files with secrets.
- **PostToolUse / Bash**: after a `git commit` that touches migrations/types/validation/nginx, reminds to run `/strawboss-sync-docs`.

### GitHub Actions (`.github/workflows/`)

`bug-scan.yml` — on every PR push (excluding docs-only changes), runs `strawboss-bug-hunt` via the Claude Code GitHub Action and posts the findings as a PR comment. Requires the `CLAUDE_CODE_OAUTH_TOKEN` repo secret and the Claude GitHub App installed.

`bug-fix.yml` — triggered automatically after a successful Bug Scan (unless the scan was triggered by the fix bot itself, preventing loops), or manually via Actions → Bug Fix → Run workflow. Uses **claude-opus-4-7** (120 turns) to: (1) read the bug-scan PR comment, (2) save a detailed fix plan to `.claude/active-bugfix-plan.md`, (3) implement each finding with a typecheck after every fix, (4) push the commits back to the PR branch, and (5) post a summary comment. Configure `min_severity` input (default: `high`) to limit scope. Findings that require DB migrations or breaking API changes are automatically deferred.

### Scheduled routine

A weekly routine runs `/strawboss-sync-docs` automatically to catch any documentation drift.

### Keeping docs fresh

The `.claude/docs/` directory is an Obsidian-compatible knowledge vault for this project. **Start every session by reading `.claude/docs/hot.md`** — it contains the five invariants, what's changing now, and quick-reference pointers. For deeper context, follow the `[[wikilinks]]` to layer-specific docs.

After non-trivial code changes, run `/strawboss-sync-docs` so future sessions read accurate context. That skill also bumps `updated:` frontmatter and appends to `.claude/docs/log.md`. MCP plugins available: `context7` (live library docs), `playwright` (browser), `supabase` (after one-time auth).

### Personal wiki (cross-project, separate from `.claude/docs/`)

The user also keeps a personal Obsidian vault at `~/claude-obsidian` (git repo, managed by the `claude-obsidian` plugin — `/wiki`, `/save`, `/autoresearch`, `/canvas`, `wiki-query`, `mcp__obsidian-vault__*`). It is **not** Strawboss-specific and is not auto-loaded here — its `SessionStart` hot-cache hook only fires when the vault itself is the working directory, so it never triggers from a Strawboss session.

When the user asks about prior research, personal notes, or "what do I know about X" that is **not** about Strawboss code/architecture:
1. Read `~/claude-obsidian/wiki/hot.md` first (recent context cache)
2. If not enough, read `~/claude-obsidian/wiki/index.md`
3. Only then drill into specific wiki pages — via `mcp__obsidian-vault__*` tools or the `claude-obsidian:wiki-query` skill

Do NOT read this personal vault for Strawboss code questions — use `.claude/docs/` above instead.
