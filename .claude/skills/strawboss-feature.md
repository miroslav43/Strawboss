---
name: strawboss-feature
description: Add a new feature to StrawBoss following established patterns and conventions
---

# StrawBoss Feature Development Guide

When adding a new feature, follow this step-by-step process. The monorepo has strict layering -- work bottom-up from types to apps.

## Step 0: Determine affected layers

Map the feature to the layers it touches. Not every feature needs all layers.

| Layer | Package/App | When needed |
|-------|------------|-------------|
| Types | `packages/types` | New entities, DTOs, enums |
| Validation | `packages/validation` | New request/form schemas |
| Domain | `packages/domain` | Business logic, state machine changes |
| API hooks | `packages/api` | New query/mutation hooks for frontend |
| Backend | `backend/service` | New endpoints, DB queries, jobs |
| Admin web | `apps/admin-web` | New dashboard pages/components |
| Mobile | `apps/mobile` | New mobile screens/offline support |
| Database | `supabase/migrations` | New tables, columns, indexes, RLS |

## Step 1: Database migration (if needed)

Create a new file: `supabase/migrations/00025_<feature_name>.sql` (use next number).

Follow these conventions:
- **Idempotent**: `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for constraints.
- **Soft delete**: Add `deleted_at TIMESTAMPTZ DEFAULT NULL` to mutable tables.
- **sync_version**: Add `sync_version BIGINT DEFAULT 0` if the table participates in mobile sync.
- **RLS**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies for admin, dispatcher, loader_operator, driver.
- **Partial indexes**: `WHERE deleted_at IS NULL` on frequently queried columns.
- **PostGIS**: Use `GEOGRAPHY(Point, 4326)` for location columns, `GEOGRAPHY(Polygon, 4326)` for boundaries.

Apply: `./strawboss.sh db:migrate`

## Step 2: Types (`packages/types`)

Add to the appropriate file in `packages/types/src/`:
- **Entities** in `entities/` -- interfaces with UUID `id`, ISO date strings, optional `deletedAt`.
- **DTOs** in `dtos/` -- `*CreateDto`, `*UpdateDto` types.
- **Enums** in `entities/` or `common.ts`.

Export from `packages/types/src/index.ts`.

Build: `pnpm --filter @strawboss/types build`

## Step 3: Validation (`packages/validation`)

Create Zod schemas that mirror the types:
- `create*Schema` for creation DTOs.
- `update*Schema` for update DTOs (all fields `.optional()` except id).
- Use `.uuid()` for IDs, `.datetime()` for dates, `.trim()` on strings.

Export from the package index.

Build: `pnpm --filter @strawboss/validation build`

## Step 4: Domain logic (`packages/domain`) -- if needed

For business rules, state machines, or pure computations:
- State machines go in `src/state-machines/` using XState v5 `setup()`.
- Fraud detection rules go in `src/fraud-detection/`.
- Reconciliation logic goes in `src/reconciliation/`.
- Export helper functions like `getAvailableTransitions()`.

Build: `pnpm --filter @strawboss/domain build`

## Step 5: API hooks (`packages/api`)

1. Add query keys to `src/queries/query-keys.ts`:
```typescript
newEntity: {
  all: ['newEntity'] as const,
  list: (filters?: Record<string, unknown>) => ['newEntity', 'list', filters] as const,
  detail: (id: string) => ['newEntity', 'detail', id] as const,
},
```

2. Create hook file `src/hooks/use-new-entity.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NewEntity, NewEntityCreateDto } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useNewEntities(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.newEntity.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<NewEntity[]>(`/api/v1/new-entity${params}`);
    },
  });
}

export function useCreateNewEntity(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewEntityCreateDto) => client.post<NewEntity>('/api/v1/new-entity', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.newEntity.all });
    },
  });
}
```

3. Export from `src/hooks/index.ts`.

Build: `pnpm --filter @strawboss/api build`

## Step 6: Backend (`backend/service`)

Create the NestJS module following the established pattern:

### 6a. Service (`new-entity.service.ts`)
- Inject `DrizzleProvider` and `WINSTON_MODULE_PROVIDER`.
- Use Drizzle `sql` template literals for queries (never `sql.raw()` with user input).
- Add `WHERE deleted_at IS NULL` to all queries.
- Add `LIMIT` to list queries.
- Log business transitions: `this.winston.log('flow', 'message', { context: 'NewEntityService', ... })`.

### 6b. Controller (`new-entity.controller.ts`)
- `@Controller('new-entity')` -- routes live under `/api/v1/`.
- `@Roles('admin' as UserRole, ...)` on all write endpoints.
- `@Body(new ZodValidationPipe(schema))` on request bodies.
- Follow `trips.controller.ts` as the canonical pattern.

### 6c. Module (`new-entity.module.ts`)
- Register service and controller.
- Import `DatabaseModule` if using DrizzleProvider.
- Register BullMQ queues if the feature has background jobs.

### 6d. Register in `app.module.ts`
- Add import to the `imports` array.

## Step 7: Admin web (`apps/admin-web`)

### 7a. Page
- Create in `src/app/(dashboard)/new-entity/page.tsx`.
- Use `'use client'` directive.
- Fetch data with hooks from `@strawboss/api`: `useNewEntities(apiClient, filters)`.
- Import `apiClient` from `@/lib/api`.
- Wrap user-visible strings with `t('newEntity.title')` from `useI18n()`.

### 7b. i18n
- Add keys to `messages/en.json` and `messages/ro.json`.

### 7c. Components
- Reuse shared components: `DataTable`, `StatusBadge`, `SearchInput` from `components/shared/`.
- Map components: `LeafletMap`, `FilterableParcelList` from `components/map/`.
- Use `normalizeList<T>()` from `lib/normalize-api-list.ts` for list responses.
- Wrap pages in `LoggingErrorBoundary`.

### 7d. Sidebar
- Add navigation link in `components/layout/Sidebar.tsx`.

## Step 8: Mobile (`apps/mobile`) -- if needed

### 8a. Screen
- Place in the correct role group: `app/(baler)/`, `app/(loader)/`, or `app/(driver)/`.
- Or in `app/(tabs)/` for screens visible to admin/dispatcher.

### 8b. Offline-first data flow
1. Create SQLite repo in `src/db/new-entity-repo.ts` following `trips-repo.ts` pattern.
2. Add migration in `src/db/migrations.ts`.
3. Write locally first, then enqueue to sync queue:
```typescript
await repo.create(entity);
await syncQueueRepo.enqueue({
  entityType: 'new_entity',
  entityId: entity.id,
  action: 'create',
  payload: entity,
  idempotencyKey: entity.id, // UUID, stable across retries
});
```

### 8c. SyncManager
- Add repo to `SyncManager` constructor in `src/sync/SyncManager.ts`.
- Add pull handler in `src/sync/pull.ts`.

## Step 9: Build and typecheck

```bash
# Build in dependency order
pnpm --filter @strawboss/types build
pnpm --filter @strawboss/validation build
pnpm --filter @strawboss/domain build
pnpm --filter @strawboss/api build

# Typecheck all apps
pnpm --filter @strawboss/backend typecheck
pnpm --filter @strawboss/admin-web typecheck
# Mobile typecheck: pnpm --filter @strawboss/mobile typecheck

# Or use the orchestrator
./strawboss.sh typecheck all
```
