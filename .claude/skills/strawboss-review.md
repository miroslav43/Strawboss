---
name: strawboss-review
description: Review code changes in the StrawBoss monorepo with project-specific checklists
---

# StrawBoss Code Review

Review the current diff (staged + unstaged, or PR diff) against these project-specific checklists. Flag any violations with severity (critical / warning / nit) and cite the file + line.

## How to run

1. Get the diff: `git diff` for local changes, or `gh pr diff <number>` for a PR.
2. Identify which layers are touched (backend, admin-web, mobile, packages, database).
3. Apply ONLY the checklists for touched layers.
4. Summarize findings grouped by severity.

---

## Backend checklist (`backend/service/src/`)

- [ ] **Auth guards present**: Every controller is protected by the global `AuthGuard` (APP_GUARD in `app.module.ts`). Public endpoints must have `@Public()` decorator from `auth/auth.guard.ts`. Verify no accidental `@Public()` on write endpoints.
- [ ] **@Roles on write endpoints**: Every `@Post`, `@Patch`, `@Put`, `@Delete` must have `@Roles(...)` with the correct `UserRole` values. Check against the pattern in `trips.controller.ts` -- roles are cast as `'admin' as UserRole`.
- [ ] **Optimistic lock on state transitions**: Trip workflow endpoints (`start-loading`, `complete-loading`, `depart`, `arrive`, `start-delivery`, `confirm-delivery`, `complete`, `cancel`, `dispute`, `resolve-dispute`) must call `getAvailableTransitions()` from `@strawboss/domain` before updating status. Check `trips.service.ts` for the pattern.
- [ ] **No sql.raw with user input**: All SQL uses Drizzle `sql` template literals with parameterized values. The sync service uses `ALLOWED_COLUMNS` allowlist in `sync.service.ts` for dynamic column names. Flag any `sql.raw()` call that takes user-supplied strings.
- [ ] **Zod validation pipe on @Body**: Every `@Body()` parameter must use `new ZodValidationPipe(schema)` with a schema from `@strawboss/validation`. Pattern: `@Body(new ZodValidationPipe(tripCreateDtoSchema)) dto: TripCreateDto`.
- [ ] **LIMIT on list queries**: List endpoints must include `LIMIT` in SQL. Check the `list()` methods in service files.
- [ ] **Ownership check on mutations**: Non-admin mutations should verify the caller owns the resource (e.g., driver can only update their own trips). Check `request.user.id` is used for scoping.
- [ ] **Winston logging**: Services should inject `@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger` and use `this.winston.log('flow', ...)` for business transitions. Check `TripsService.logTripFlow` for the pattern.
- [ ] **BullMQ queue registration**: New queues must be added to `queues.ts` constants and registered in `jobs.module.ts`. Repeating jobs go in `job-scheduler.service.ts`.
- [ ] **Soft delete respected**: Queries must include `WHERE deleted_at IS NULL` unless explicitly fetching archived records.

## Admin-web checklist (`apps/admin-web/`)

- [ ] **XSS in Leaflet popups**: Any string rendered in LeafletMap popup HTML must be wrapped with the `esc()` function defined in `LeafletMap.tsx`. Raw user input in popup HTML is a critical XSS vector.
- [ ] **i18n -- no hardcoded strings**: All user-visible text must use `t('key.path')` from `useI18n()` hook (`lib/i18n.tsx`). Check for bare English strings in JSX. Message keys go in `messages/en.json` and `messages/ro.json`.
- [ ] **useEffect cleanup**: Effects that set up subscriptions (Supabase auth, realtime channels) must return a cleanup function. See `(dashboard)/layout.tsx` for the pattern with `active` flag and `subscription.unsubscribe()`.
- [ ] **Error boundaries**: Pages with data fetching should be wrapped in `LoggingErrorBoundary` from `components/shared/LoggingErrorBoundary.tsx`.
- [ ] **normalizeList() from shared module**: When consuming list API responses, use `normalizeList<T>()` from `lib/normalize-api-list.ts` -- the backend may return `T[]` or `{ data: T[] }`.
- [ ] **apiClient from lib/api**: All API calls must use the shared `apiClient` from `@/lib/api`, not raw `fetch`. The client handles JWT injection and base URL.
- [ ] **TanStack Query hooks**: Data fetching should use hooks from `@strawboss/api` (e.g., `useTrips`, `useTrip`) with the `queryKeys` factory for cache key consistency.
- [ ] **RealtimeProvider context**: Dashboard pages render inside `RealtimeProvider` (from layout.tsx). Verify new realtime subscriptions use the existing pattern.

## Mobile checklist (`apps/mobile/`)

- [ ] **Idempotency keys stable**: Sync queue entries must use UUID-based idempotency keys (not `Date.now()` or random per-retry). Check `EnqueueInput.idempotencyKey` in `db/sync-queue-repo.ts`. Keys must be generated once at write time and persist across retries.
- [ ] **Sync queue used for offline writes**: All data mutations must go through `SyncQueueRepo.enqueue()` first, not direct API calls. Pattern: local SQLite write -> sync queue entry -> SyncManager pushes on next cycle.
- [ ] **Geofence overlay handles rapid events**: If modifying geofence-related code, verify the overlay does not fire duplicate alerts for the same boundary crossing. Check for debounce or dedup logic.
- [ ] **UUID for record IDs**: All locally-created records must use UUID strings as IDs (not auto-increment integers). This prevents conflicts during sync.
- [ ] **Logger uses batch flush**: Mobile logging via `mobileLogger` in `lib/logger.ts` appends to NDJSON files. Logs are uploaded after successful sync via `uploadTodayMobileLogs()`. Verify no synchronous file I/O on the main thread.
- [ ] **Role-based routing**: The `_layout.tsx` root layout uses `ROLE_ROUTES` to direct users to `/(baler)`, `/(loader)`, or `/(driver)`. New role-specific screens must go in the correct group.
- [ ] **mobileApiClient for direct calls**: Direct API calls (not synced) use `mobileApiClient` from `lib/api-client.ts` (e.g., profile fetch, push token registration).

## Database checklist (`supabase/migrations/`)

- [ ] **RLS enabled**: New tables must have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. See `00008_rls_policies.sql`.
- [ ] **Policies for all roles**: Each table needs policies for admin (full CRUD), dispatcher, loader_operator, driver as appropriate. Admin policy pattern: `CREATE POLICY admin_all_<table> ON <table> FOR ALL USING (public.user_role() = 'admin') WITH CHECK (public.user_role() = 'admin')`.
- [ ] **Migrations idempotent**: Use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for constraints. Use `DROP POLICY IF EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`. See `00024_partial_indexes.sql` for pattern.
- [ ] **Partial indexes with WHERE deleted_at IS NULL**: Indexes on tables with soft delete should be partial: `CREATE INDEX ... WHERE deleted_at IS NULL`. See `00024_partial_indexes.sql`.
- [ ] **sync_version column**: Tables that participate in mobile sync must have a `sync_version BIGINT` column. Check `SYNCABLE_TABLES` in `backend/service/src/sync/sync.service.ts`.
- [ ] **PostGIS usage**: Spatial queries must use `ST_Contains`, `ST_MakePoint`, etc. from PostGIS. Boundary columns store GeoJSON polygons.

## Packages checklist (`packages/`)

- [ ] **Types match DB schema**: Interfaces in `packages/types/src/entities/` must match the database columns from migrations. All IDs are UUID strings, all dates are ISO 8601 strings, mutable entities have `deletedAt?: string | null`.
- [ ] **Validation schemas match types**: Zod schemas in `packages/validation/` must have `create*Schema` / `update*Schema` variants matching the corresponding type DTOs.
- [ ] **Hooks use queryKeys factory**: All TanStack Query hooks in `packages/api/src/hooks/` must use keys from `packages/api/src/queries/query-keys.ts`. Never use ad-hoc string arrays for query keys.
- [ ] **Domain state machine guards**: The XState v5 trip machine in `packages/domain/src/state-machines/trip.machine.ts` must have guards that match the business rules. `getAvailableTransitions()` is called by the backend before any state change.
- [ ] **Build order respected**: Changes to `types` require rebuilding `validation -> domain -> api` before apps. Changes to `validation` require rebuilding `domain -> api`. Run `pnpm --filter @strawboss/<pkg> build` in dependency order.
