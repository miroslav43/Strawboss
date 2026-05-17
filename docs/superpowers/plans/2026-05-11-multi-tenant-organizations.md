# Multi-Tenant Organizations (Option B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-tenant support so multiple businesses (e.g. StrawBoss, StrawKing) share one server but each sees only their own data — isolated at application layer, routed via `/[slug]/dashboard`.

**Architecture:** Single Postgres schema. Every entity table gains `organization_id UUID`. The backend extracts `organizationId` from the JWT (injected by a Supabase hook) and passes it through every service call as a WHERE filter. Admin web routes move under `/[slug]/(dashboard)/`. A new `super_admin` role bypasses all org filters and manages orgs from `/super-admin/`.

**Tech Stack:** PostgreSQL migrations (psql via `./strawboss.sh db:migrate`), NestJS 11 + Fastify, Drizzle ORM raw SQL (`drizzle-orm/postgres-js`), Next.js 15 App Router `[slug]` segment, Supabase Custom Access Token Hook.

---

## File Map

### New files
- `supabase/migrations/00034_organizations.sql` — adds `organizations` table + `organization_id` on all entity tables + fixes unique constraints
- `supabase/migrations/00035_super_admin_role.sql` — adds `super_admin` to `user_role` enum
- `supabase/migrations/00036_jwt_org_hook.sql` — updates JWT hook to inject `organization_id` + `organization_slug`
- `packages/types/src/entities/organization.ts` — `Organization` interface
- `backend/service/src/organizations/organizations.module.ts`
- `backend/service/src/organizations/organizations.service.ts`
- `backend/service/src/organizations/organizations.controller.ts`
- `apps/admin-web/src/hooks/useOrgSlug.ts` — reads `params.slug` from Next.js route
- `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx` — moved + org guard
- `apps/admin-web/src/app/[slug]/(dashboard)/page.tsx` — moved dashboard home
- `apps/admin-web/src/app/[slug]/(dashboard)/[all other pages]/` — all dashboard pages moved under `[slug]`
- `apps/admin-web/src/app/super-admin/(dashboard)/layout.tsx`
- `apps/admin-web/src/app/super-admin/(dashboard)/page.tsx`
- `apps/admin-web/src/app/super-admin/(dashboard)/organizations/page.tsx`
- `apps/admin-web/src/app/super-admin/(dashboard)/organizations/new/page.tsx`

### Modified files
- `packages/types/src/entities/user.ts` — add `super_admin` to `UserRole`
- `packages/types/src/index.ts` — export `Organization`
- `packages/validation/src/index.ts` — export `createOrganizationSchema`
- `packages/validation/src/schemas/organization.schema.ts` — NEW schema file
- `backend/service/src/auth/auth.guard.ts` — add `organizationId`, `organizationSlug` to `RequestUser`
- `backend/service/src/app.module.ts` — import `OrganizationsModule`
- `backend/service/src/admin-users/admin-users.service.ts` — scope all queries by org
- `backend/service/src/admin-users/admin-users.controller.ts` — pass `user.organizationId`
- `backend/service/src/machines/machines.service.ts` — scope all queries by org
- `backend/service/src/machines/machines.controller.ts` — pass `user.organizationId`
- `backend/service/src/parcels/parcels.service.ts` — scope all queries by org
- `backend/service/src/parcels/parcels.controller.ts` — pass `user.organizationId`
- `backend/service/src/farms/farms.service.ts` — scope all queries by org
- `backend/service/src/farms/farms.controller.ts` — pass `user.organizationId`
- `backend/service/src/delivery-destinations/delivery-destinations.service.ts` — scope by org
- `backend/service/src/delivery-destinations/delivery-destinations.controller.ts`
- `backend/service/src/trips/trips.service.ts` — scope all queries by org
- `backend/service/src/trips/trips.controller.ts`
- `backend/service/src/task-assignments/task-assignments.service.ts` — scope by org
- `backend/service/src/task-assignments/task-assignments.controller.ts`
- `backend/service/src/bale-loads/bale-loads.service.ts` — scope by org
- `backend/service/src/bale-loads/bale-loads.controller.ts`
- `backend/service/src/bale-productions/bale-productions.service.ts` — scope by org
- `backend/service/src/bale-productions/bale-productions.controller.ts`
- `backend/service/src/fuel-logs/fuel-logs.service.ts` — scope by org
- `backend/service/src/fuel-logs/fuel-logs.controller.ts`
- `backend/service/src/consumable-logs/consumable-logs.service.ts` — scope by org
- `backend/service/src/consumable-logs/consumable-logs.controller.ts`
- `backend/service/src/documents/documents.service.ts` — scope by org
- `backend/service/src/alerts/alerts.service.ts` — scope by org
- `backend/service/src/dashboard/dashboard.service.ts` — scope all aggregates by org
- `backend/service/src/dashboard/dashboard.controller.ts`
- `backend/service/src/sync/sync.service.ts` — stamp INSERT with org, filter pull by org
- `backend/service/src/sync/sync.controller.ts` — pass `user.organizationId`
- `backend/service/src/notifications/notifications.service.ts` — scope device tokens by org
- `backend/service/src/parcel-daily-status/parcel-daily-status.service.ts` — scope by org
- `apps/admin-web/src/app/(auth)/login/page.tsx` — redirect to `/${slug}/` or `/super-admin` after auth
- `apps/admin-web/src/app/page.tsx` — become a redirect to `/login`
- `apps/admin-web/src/components/layout/Sidebar.tsx` — prefix all hrefs with `/${slug}`

---

## Task 1: DB Migration — organizations table + organization_id columns

**Files:**
- Create: `supabase/migrations/00034_organizations.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/00034_organizations.sql
-- Adds multi-tenant organizations table and organization_id to all entity tables.

-- ============================================================
-- 1. organizations table
-- ============================================================
CREATE TABLE organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Seed the default organization for all pre-existing data.
-- Use a deterministic UUID so it can be referenced in future migrations.
INSERT INTO organizations (id, slug, name)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'strawboss',
  'StrawBoss'
);

-- ============================================================
-- 2. Add organization_id to all entity tables (nullable first,
--    then backfill, then NOT NULL where required)
-- ============================================================
ALTER TABLE users                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE machines             ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE parcels              ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE delivery_destinations ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE farms                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE trips                ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE task_assignments     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE bale_loads           ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE bale_productions     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE fuel_logs            ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE consumable_logs      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE documents            ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE alerts               ADD COLUMN organization_id UUID REFERENCES organizations(id);

-- ============================================================
-- 3. Backfill all existing rows to the default organization
-- ============================================================
UPDATE users                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE machines             SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE parcels              SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE delivery_destinations SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE farms                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE trips                SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE task_assignments     SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE bale_loads           SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE bale_productions     SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE fuel_logs            SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE consumable_logs      SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE documents            SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE alerts               SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;

-- Note: users with role 'super_admin' will have organization_id = NULL (set manually).
-- All other tables: NOT NULL after backfill.
ALTER TABLE machines             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE parcels              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE delivery_destinations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE farms                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE trips                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE task_assignments     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bale_loads           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bale_productions     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE fuel_logs            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE consumable_logs      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE documents            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE alerts               ALTER COLUMN organization_id SET NOT NULL;
-- users.organization_id stays nullable (super_admin users have null)

-- ============================================================
-- 4. Fix unique constraints to be per-org (not globally unique)
-- ============================================================
ALTER TABLE parcels DROP CONSTRAINT parcels_code_key;
ALTER TABLE parcels ADD CONSTRAINT parcels_code_org_unique UNIQUE (code, organization_id);

ALTER TABLE machines DROP CONSTRAINT machines_internal_code_key;
ALTER TABLE machines ADD CONSTRAINT machines_internal_code_org_unique UNIQUE (internal_code, organization_id);

ALTER TABLE delivery_destinations DROP CONSTRAINT delivery_destinations_code_key;
ALTER TABLE delivery_destinations ADD CONSTRAINT delivery_destinations_code_org_unique UNIQUE (code, organization_id);

-- ============================================================
-- 5. Indexes on organization_id for query performance
-- ============================================================
CREATE INDEX idx_users_org_id                ON users (organization_id);
CREATE INDEX idx_machines_org_id             ON machines (organization_id);
CREATE INDEX idx_parcels_org_id              ON parcels (organization_id);
CREATE INDEX idx_delivery_destinations_org_id ON delivery_destinations (organization_id);
CREATE INDEX idx_farms_org_id                ON farms (organization_id);
CREATE INDEX idx_trips_org_id                ON trips (organization_id);
CREATE INDEX idx_task_assignments_org_id     ON task_assignments (organization_id);
CREATE INDEX idx_bale_loads_org_id           ON bale_loads (organization_id);
CREATE INDEX idx_bale_productions_org_id     ON bale_productions (organization_id);
CREATE INDEX idx_fuel_logs_org_id            ON fuel_logs (organization_id);
CREATE INDEX idx_consumable_logs_org_id      ON consumable_logs (organization_id);
CREATE INDEX idx_documents_org_id            ON documents (organization_id);
CREATE INDEX idx_alerts_org_id               ON alerts (organization_id);

-- Grant supabase_auth_admin SELECT on organizations so the JWT hook can read slugs.
GRANT SELECT ON public.organizations TO supabase_auth_admin;
```

- [ ] **Step 2: Run the migration**

```bash
./strawboss.sh db:migrate
```

Expected: no errors. Verify:
```bash
psql $DATABASE_URL -c "\d organizations" -c "SELECT COUNT(*) FROM organizations;"
```
Expected: table exists, 1 row (the default org).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00034_organizations.sql
git commit -m "feat(db): add organizations table + organization_id to all entity tables"
```

---

## Task 2: DB Migration — super_admin role

**Files:**
- Create: `supabase/migrations/00035_super_admin_role.sql`

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/00035_super_admin_role.sql
-- Adds super_admin value to user_role enum.
-- super_admin users bypass all organization filters.
-- They are created manually (not via the admin-users endpoint) and have
-- organization_id = NULL in public.users.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
```

- [ ] **Step 2: Run and verify**

```bash
./strawboss.sh db:migrate
psql $DATABASE_URL -c "SELECT enum_range(NULL::user_role);"
```

Expected output includes `super_admin`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00035_super_admin_role.sql
git commit -m "feat(db): add super_admin value to user_role enum"
```

---

## Task 3: DB Migration — update JWT hook to inject org context

**Files:**
- Create: `supabase/migrations/00036_jwt_org_hook.sql`

> **Note:** After running this migration, you must re-enable the hook in the Supabase Dashboard:
> Authentication → Hooks → Custom Access Token → Function: `public.custom_access_token_hook`
> (It gets replaced in-place, so just save again to re-activate.)

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/00036_jwt_org_hook.sql
-- Extends the JWT hook to inject organization_id and organization_slug
-- into app_metadata so the backend and frontend can read them from the token.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_role text;
  org_id   uuid;
  org_slug text;
BEGIN
  SELECT u.role::text, u.organization_id
  INTO app_role, org_id
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid
    AND u.deleted_at IS NULL;

  IF app_role IS NOT NULL THEN
    event := jsonb_set(event, '{claims,app_metadata,role}', to_jsonb(app_role));
  END IF;

  IF org_id IS NOT NULL THEN
    event := jsonb_set(
      event,
      '{claims,app_metadata,organization_id}',
      to_jsonb(org_id::text)
    );

    SELECT o.slug INTO org_slug
    FROM public.organizations o
    WHERE o.id = org_id AND o.deleted_at IS NULL;

    IF org_slug IS NOT NULL THEN
      event := jsonb_set(
        event,
        '{claims,app_metadata,organization_slug}',
        to_jsonb(org_slug)
      );
    END IF;
  END IF;

  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
GRANT SELECT ON public.users TO supabase_auth_admin;
GRANT SELECT ON public.organizations TO supabase_auth_admin;
```

- [ ] **Step 2: Run and verify**

```bash
./strawboss.sh db:migrate
psql $DATABASE_URL -c "SELECT proname FROM pg_proc WHERE proname = 'custom_access_token_hook';"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00036_jwt_org_hook.sql
git commit -m "feat(db): update JWT hook to inject organization_id and organization_slug"
```

---

## Task 4: Types Package — Organization interface + super_admin role

**Files:**
- Create: `packages/types/src/entities/organization.ts`
- Modify: `packages/types/src/entities/user.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create Organization type**

```typescript
// packages/types/src/entities/organization.ts
import type { Timestamps, SoftDelete } from '../common.js';

export interface Organization extends Timestamps, SoftDelete {
  id: string;
  slug: string;
  name: string;
}

export interface CreateOrganizationDto {
  slug: string;
  name: string;
}
```

- [ ] **Step 2: Add super_admin to UserRole**

In `packages/types/src/entities/user.ts`, add `super_admin` to the enum:

```typescript
export enum UserRole {
  super_admin = "super_admin",   // ← add this line at the top
  admin = "admin",
  dispatcher = "dispatcher",
  baler_operator = "baler_operator",
  loader_operator = "loader_operator",
  driver = "driver",
  geofence_maker = "geofence_maker",
}
```

- [ ] **Step 3: Export Organization from index**

In `packages/types/src/index.ts`, find the entities export block and add:

```typescript
export type { Organization, CreateOrganizationDto } from './entities/organization.js';
```

- [ ] **Step 4: Build and verify**

```bash
./strawboss.sh build packages
```

Expected: builds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/entities/organization.ts packages/types/src/entities/user.ts packages/types/src/index.ts
git commit -m "feat(types): add Organization type and super_admin role"
```

---

## Task 5: Validation Package — createOrganizationSchema

**Files:**
- Create: `packages/validation/src/schemas/organization.schema.ts`
- Modify: `packages/validation/src/index.ts`

- [ ] **Step 1: Create organization schema**

```typescript
// packages/validation/src/schemas/organization.schema.ts
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  name: z.string().min(2).max(100),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
```

- [ ] **Step 2: Export from validation index**

In `packages/validation/src/index.ts`, add:

```typescript
export { createOrganizationSchema } from './schemas/organization.schema.js';
export type { CreateOrganizationInput } from './schemas/organization.schema.js';
```

- [ ] **Step 3: Build and verify**

```bash
./strawboss.sh build packages
```

- [ ] **Step 4: Commit**

```bash
git add packages/validation/src/schemas/organization.schema.ts packages/validation/src/index.ts
git commit -m "feat(validation): add createOrganizationSchema"
```

---

## Task 6: Backend — Update RequestUser + AuthGuard

This is the foundation of all org isolation. The JWT now carries `organization_id` and `organization_slug`; the guard must extract them.

**Files:**
- Modify: `backend/service/src/auth/auth.guard.ts`

- [ ] **Step 1: Update RequestUser interface and guard extraction**

Replace the existing `RequestUser` interface and the `request.user = { ... }` assignment block in `auth.guard.ts`:

```typescript
export interface RequestUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;    // null for super_admin
  organizationSlug: string | null;  // null for super_admin
}
```

Find the block near the bottom of `canActivate` where `request.user` is assigned and replace it:

```typescript
const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
const role =
  (appMeta?.role as string | undefined) ??
  (payload.user_role as string | undefined) ??
  (payload.role as string | undefined) ??
  '';

const organizationId =
  (appMeta?.organization_id as string | undefined) ?? null;
const organizationSlug =
  (appMeta?.organization_slug as string | undefined) ?? null;

request.user = {
  id: (payload.sub as string) ?? '',
  email: (payload.email as string) ?? '',
  role,
  organizationId,
  organizationSlug,
} satisfies RequestUser;
```

- [ ] **Step 2: Build the backend to catch any type errors early**

```bash
./strawboss.sh typecheck backend
```

Expected: TypeScript errors appear wherever `request.user` is used without `organizationId` — those will be fixed in subsequent tasks. The guard itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add backend/service/src/auth/auth.guard.ts
git commit -m "feat(auth): add organizationId and organizationSlug to RequestUser"
```

---

## Task 7: Backend — Organizations module (CRUD for super_admin)

**Files:**
- Create: `backend/service/src/organizations/organizations.service.ts`
- Create: `backend/service/src/organizations/organizations.controller.ts`
- Create: `backend/service/src/organizations/organizations.module.ts`
- Modify: `backend/service/src/app.module.ts`

- [ ] **Step 1: Create OrganizationsService**

```typescript
// backend/service/src/organizations/organizations.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { Organization, CreateOrganizationDto } from '@strawboss/types';

const ORG_COLS = sql`id, slug, name, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;

@Injectable()
export class OrganizationsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(): Promise<Organization[]> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return result as unknown as Organization[];
  }

  async findById(id: string): Promise<Organization> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Organization[];
    if (!rows.length) throw new NotFoundException(`Organization ${id} not found`);
    return rows[0];
  }

  async findBySlug(slug: string): Promise<Organization> {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${ORG_COLS} FROM organizations WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Organization[];
    if (!rows.length) throw new NotFoundException(`Organization '${slug}' not found`);
    return rows[0];
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const existing = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM organizations WHERE slug = ${dto.slug} LIMIT 1`,
    );
    if ((existing as unknown as { id: string }[]).length) {
      throw new ConflictException(`Organization slug '${dto.slug}' already exists`);
    }
    const result = await this.drizzleProvider.db.execute(sql`
      INSERT INTO organizations (slug, name)
      VALUES (${dto.slug}, ${dto.name})
      RETURNING ${ORG_COLS}
    `);
    return (result as unknown as Organization[])[0];
  }
}
```

- [ ] **Step 2: Create OrganizationsController**

```typescript
// backend/service/src/organizations/organizations.controller.ts
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '@strawboss/types';
import type { CreateOrganizationDto } from '@strawboss/types';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @Roles(UserRole.super_admin)
  list() {
    return this.organizationsService.list();
  }

  @Get(':id')
  @Roles(UserRole.super_admin)
  findById(@Param('id') id: string) {
    return this.organizationsService.findById(id);
  }

  @Post()
  @Roles(UserRole.super_admin)
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(dto);
  }
}
```

- [ ] **Step 3: Create OrganizationsModule**

```typescript
// backend/service/src/organizations/organizations.module.ts
import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';

@Module({
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
```

- [ ] **Step 4: Register in AppModule**

In `backend/service/src/app.module.ts`, add the import:

```typescript
import { OrganizationsModule } from './organizations/organizations.module';
```

And add `OrganizationsModule` to the `imports` array (anywhere after `DatabaseModule`).

- [ ] **Step 5: Build and verify**

```bash
./strawboss.sh typecheck backend
```

Expected: no errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add backend/service/src/organizations/
git add backend/service/src/app.module.ts
git commit -m "feat(backend): add OrganizationsModule for super_admin management"
```

---

## Task 8: Backend — AdminUsersService scoped by org (full pattern example)

This task shows the full pattern used by every service. Tasks 9–20 follow the same shape; read this one carefully.

**Files:**
- Modify: `backend/service/src/admin-users/admin-users.service.ts`
- Modify: `backend/service/src/admin-users/admin-users.controller.ts`

**The pattern:**
- Every `list()` → gets `orgId: string | null` as first param; adds `AND organization_id = ${orgId}::uuid` to WHERE (skipped when null)
- Every `create()` → gets `orgId: string` as first param; adds `organization_id` to the INSERT
- Every `findById()` / `getById()` → adds `AND organization_id = ${orgId}::uuid` to prevent cross-org ID lookups
- Controllers extract `user.organizationId` from `@CurrentUser()` and pass it to the service

- [ ] **Step 1: Update `list()` in AdminUsersService**

Find the `list()` method (which currently runs `SELECT ... FROM users WHERE deleted_at IS NULL`) and replace its signature and WHERE clause:

```typescript
async list(orgId: string | null): Promise<User[]> {
  const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];
  if (orgId !== null) {
    conditions.push(sql`organization_id = ${orgId}::uuid`);
  }
  const where = sql.join(conditions, sql` AND `);
  const result = await this.drizzleProvider.db.execute(sql`
    SELECT ${USER_SELECT_COLS}
    FROM users
    WHERE ${where}
    ORDER BY full_name ASC
  `);
  return result as unknown as User[];
}
```

- [ ] **Step 2: Update `getById()` in AdminUsersService**

Add an `orgId` param to prevent cross-org lookups:

```typescript
async getById(id: string, orgId: string | null): Promise<User> {
  const conditions: ReturnType<typeof sql>[] = [
    sql`id = ${id}::uuid`,
    sql`deleted_at IS NULL`,
  ];
  if (orgId !== null) {
    conditions.push(sql`organization_id = ${orgId}::uuid`);
  }
  const where = sql.join(conditions, sql` AND `);
  const result = await this.drizzleProvider.db.execute(
    sql`SELECT ${USER_SELECT_COLS} FROM users WHERE ${where} LIMIT 1`,
  );
  const rows = result as unknown as User[];
  if (!rows.length) throw new NotFoundException(`User ${id} not found`);
  return rows[0];
}
```

- [ ] **Step 3: Update `createUser()` to stamp organization_id**

Find the INSERT statement in `createUser()` and add `organization_id`:

```typescript
async createUser(orgId: string, dto: CreateUserDto): Promise<User> {
  // ... (existing credential generation unchanged)
  const insertResult = await this.drizzleProvider.db.execute(sql`
    INSERT INTO users (id, email, username, pin, phone, full_name, role, is_active, locale, organization_id)
    VALUES (
      ${authId}::uuid,
      ${email},
      ${username},
      ${pin},
      ${dto.phone ?? null},
      ${dto.fullName},
      ${dto.role}::user_role,
      true,
      'ro',
      ${orgId}::uuid
    )
    RETURNING ${USER_SELECT_COLS}
  `);
  const rows = insertResult as unknown as User[];
  return rows[0];
}
```

- [ ] **Step 4: Update `updateUser()` calls to `getById`**

Inside `updateUser()`, anywhere it calls `this.getById(id)`, change to `this.getById(id, orgId)` — add `orgId: string | null` to `updateUser`'s signature as first parameter.

- [ ] **Step 5: Update `deleteUser()` (soft-delete) similarly**

Add `orgId: string | null` as first param; add to the WHERE clause:

```typescript
async deleteUser(id: string, orgId: string | null): Promise<void> {
  const conditions: ReturnType<typeof sql>[] = [
    sql`id = ${id}::uuid`,
    sql`deleted_at IS NULL`,
  ];
  if (orgId !== null) {
    conditions.push(sql`organization_id = ${orgId}::uuid`);
  }
  const where = sql.join(conditions, sql` AND `);
  await this.drizzleProvider.db.execute(
    sql`UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE ${where}`,
  );
}
```

- [ ] **Step 6: Update AdminUsersController to pass orgId from JWT**

In `admin-users.controller.ts`, every handler that calls a service method must pass `user.organizationId`. Example pattern for all handlers:

```typescript
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.guard';

// GET /
@Get()
@Roles(UserRole.admin, UserRole.super_admin)
list(@CurrentUser() user: RequestUser) {
  return this.adminUsersService.list(user.organizationId);
}

// POST /
@Post()
@Roles(UserRole.admin, UserRole.super_admin)
create(@Body() dto: CreateUserDto, @CurrentUser() user: RequestUser) {
  if (!user.organizationId) throw new ForbiddenException('super_admin must specify org');
  return this.adminUsersService.createUser(user.organizationId, dto);
}

// GET /:id
@Get(':id')
@Roles(UserRole.admin, UserRole.super_admin)
findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
  return this.adminUsersService.getById(id, user.organizationId);
}

// PATCH /:id
@Patch(':id')
@Roles(UserRole.admin, UserRole.super_admin)
update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: RequestUser) {
  return this.adminUsersService.updateUser(id, user.organizationId, dto);
}

// DELETE /:id
@Delete(':id')
@Roles(UserRole.admin, UserRole.super_admin)
delete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
  return this.adminUsersService.deleteUser(id, user.organizationId);
}
```

- [ ] **Step 7: Build and verify**

```bash
./strawboss.sh typecheck backend
```

- [ ] **Step 8: Commit**

```bash
git add backend/service/src/admin-users/
git commit -m "feat(backend): scope admin-users by organization_id"
```

---

## Task 9: Backend — MachinesService scoped by org

**Files:**
- Modify: `backend/service/src/machines/machines.service.ts`
- Modify: `backend/service/src/machines/machines.controller.ts`

Same pattern as Task 8. Key changes:

- [ ] **Step 1: Update `list(orgId, filters?)`**

```typescript
async list(orgId: string | null, filters?: { machineType?: string; isActive?: boolean }) {
  const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];
  if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
  if (filters?.machineType) conditions.push(sql`machine_type = ${filters.machineType}`);
  if (filters?.isActive !== undefined) conditions.push(sql`is_active = ${filters.isActive}`);
  const where = sql.join(conditions, sql` AND `);
  return this.drizzleProvider.db.execute(
    sql`SELECT ${MACHINE_COLS} FROM machines WHERE ${where} ORDER BY created_at DESC`,
  );
}
```

- [ ] **Step 2: Update `findById(id, orgId)` — add org filter**

Add `AND organization_id = ${orgId}::uuid` when `orgId !== null`.

- [ ] **Step 3: Update `create(orgId, dto)` — add `organization_id` to INSERT**

Add `, ${orgId}::uuid` to the INSERT VALUES and `organization_id` to the column list.

- [ ] **Step 4: Update `update(id, orgId, dto)` / `delete(id, orgId)` — add org filter to WHERE**

- [ ] **Step 5: Update controller — inject `user.organizationId` into all calls**

All handlers: `@CurrentUser() user: RequestUser` → pass `user.organizationId` as first arg.

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/machines/
git commit -m "feat(backend): scope machines by organization_id"
```

---

## Task 10: Backend — ParcelsService scoped by org

**Files:**
- Modify: `backend/service/src/parcels/parcels.service.ts`
- Modify: `backend/service/src/parcels/parcels.controller.ts`

Follow the exact same pattern as Task 9.

- [ ] **Step 1: Update `list(orgId, filters?)`** — add org filter to conditions array

- [ ] **Step 2: Update `findById(id, orgId)`** — add org filter

- [ ] **Step 3: Update `create(orgId, dto)`** — stamp `organization_id` in INSERT

- [ ] **Step 4: Update `update(id, orgId, dto)` / `delete(id, orgId)`** — add org filter to WHERE

- [ ] **Step 5: Update controller** — pass `user.organizationId`

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/parcels/
git commit -m "feat(backend): scope parcels by organization_id"
```

---

## Task 11: Backend — FarmsService scoped by org

**Files:**
- Modify: `backend/service/src/farms/farms.service.ts`
- Modify: `backend/service/src/farms/farms.controller.ts`

Same pattern as Task 9.

- [ ] **Step 1-5: Apply the org-scoping pattern** (list, findById, create, update/delete, controller)

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/farms/
git commit -m "feat(backend): scope farms by organization_id"
```

---

## Task 12: Backend — DeliveryDestinationsService scoped by org

**Files:**
- Modify: `backend/service/src/delivery-destinations/delivery-destinations.service.ts`
- Modify: `backend/service/src/delivery-destinations/delivery-destinations.controller.ts`

Same pattern as Task 9.

- [ ] **Step 1-5: Apply the org-scoping pattern**

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/delivery-destinations/
git commit -m "feat(backend): scope delivery-destinations by organization_id"
```

---

## Task 13: Backend — TaskAssignmentsService scoped by org

**Files:**
- Modify: `backend/service/src/task-assignments/task-assignments.service.ts`
- Modify: `backend/service/src/task-assignments/task-assignments.controller.ts`

Same pattern. The `list()` method already accepts filters — add `orgId` as first param.
Note: `create(orgId, dto)` must stamp `organization_id` on INSERT.

- [ ] **Step 1-5: Apply the org-scoping pattern**

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/task-assignments/
git commit -m "feat(backend): scope task-assignments by organization_id"
```

---

## Task 14: Backend — TripsService scoped by org

**Files:**
- Modify: `backend/service/src/trips/trips.service.ts`
- Modify: `backend/service/src/trips/trips.controller.ts`

The trips service is the most complex — it has many methods. Apply org-scoping everywhere a trip is listed, fetched, created, or updated.

Key points:
- `list(orgId, filters?)` — add org filter
- `findById(id, orgId)` — add org guard so one org can't read another's trip
- `create(orgId, dto)` — stamp `organization_id` on INSERT
- All transition methods (`startLoading`, `depart`, etc.) call `findById(id, orgId)` — they already scope to the right org
- `autoUpsertFromTruckTask` — this is called internally by the backend, passing the org from the task; find the task's `organization_id` via a JOIN when looking up the task

- [ ] **Step 1: Update `list()` signature and WHERE clause**

```typescript
async list(orgId: string | null, filters?: { status?: string; date?: string; ... }) {
  const conditions: ReturnType<typeof sql>[] = [sql`t.deleted_at IS NULL`];
  if (orgId !== null) conditions.push(sql`t.organization_id = ${orgId}::uuid`);
  // ... rest of existing filters unchanged
}
```

- [ ] **Step 2: Update `findById(id, orgId)` — add org guard**

```typescript
async findById(id: string, orgId: string | null) {
  // existing SELECT... WHERE id = ${id}
  // add: AND (${orgId}::uuid IS NULL OR organization_id = ${orgId}::uuid)
}
```

- [ ] **Step 3: Update `create(orgId, dto)` — stamp organization_id in INSERT**

Add `, organization_id` to column list and `, ${orgId}::uuid` to VALUES.

- [ ] **Step 4: Update `autoUpsertFromTruckTask` — derive orgId from task**

This method looks up a `task_assignments` row. Add a JOIN or sub-select to get `organization_id` from it, then pass it to the trip INSERT.

```typescript
// Near the task lookup inside autoUpsertFromTruckTask:
const taskRows = await this.drizzleProvider.db.execute(sql`
  SELECT ta.*, ta.organization_id AS "organizationId"
  FROM task_assignments ta WHERE ta.id = ${taskId}::uuid ...
`);
const orgId: string = taskRows[0].organizationId;
// then pass orgId to the trip INSERT
```

- [ ] **Step 5: Update all transition method calls to pass orgId**

Each controller transition endpoint (`startLoading`, `depart`, etc.) calls `findById`. Pass `user.organizationId` from the controller:

```typescript
@Post(':id/start-loading')
async startLoading(@Param('id') id: string, @CurrentUser() user: RequestUser, ...) {
  return this.tripsService.startLoading(id, user.organizationId, dto);
}
```

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/trips/
git commit -m "feat(backend): scope trips by organization_id"
```

---

## Task 15: Backend — BaleLoadsService scoped by org

**Files:**
- Modify: `backend/service/src/bale-loads/bale-loads.service.ts`
- Modify: `backend/service/src/bale-loads/bale-loads.controller.ts`

Same pattern as Task 9. Note: `create(orgId, dto)` stamps `organization_id` on INSERT.

- [ ] **Step 1-5: Apply the org-scoping pattern**

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/bale-loads/
git commit -m "feat(backend): scope bale-loads by organization_id"
```

---

## Task 16: Backend — BaleProductionsService scoped by org

**Files:**
- Modify: `backend/service/src/bale-productions/bale-productions.service.ts`
- Modify: `backend/service/src/bale-productions/bale-productions.controller.ts`

Same pattern as Task 9.

- [ ] **Step 1-5: Apply the org-scoping pattern**

- [ ] **Step 6: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/bale-productions/
git commit -m "feat(backend): scope bale-productions by organization_id"
```

---

## Task 17: Backend — FuelLogsService + ConsumableLogsService scoped by org

**Files:**
- Modify: `backend/service/src/fuel-logs/fuel-logs.service.ts`
- Modify: `backend/service/src/fuel-logs/fuel-logs.controller.ts`
- Modify: `backend/service/src/consumable-logs/consumable-logs.service.ts`
- Modify: `backend/service/src/consumable-logs/consumable-logs.controller.ts`

Same pattern as Task 9 for both.

- [ ] **Step 1-5: Apply the org-scoping pattern to fuel-logs**

- [ ] **Step 6: Apply the org-scoping pattern to consumable-logs**

- [ ] **Step 7: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/fuel-logs/ backend/service/src/consumable-logs/
git commit -m "feat(backend): scope fuel-logs and consumable-logs by organization_id"
```

---

## Task 18: Backend — DocumentsService + AlertsService + ParcelDailyStatusService scoped by org

**Files:**
- Modify: `backend/service/src/documents/documents.service.ts`
- Modify: `backend/service/src/alerts/alerts.service.ts`
- Modify: `backend/service/src/parcel-daily-status/parcel-daily-status.service.ts`
- Corresponding controllers

Same pattern as Task 9 for all three.

- [ ] **Step 1-3: Apply org-scoping to documents, alerts, parcel-daily-status**

- [ ] **Step 4: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/documents/ backend/service/src/alerts/ backend/service/src/parcel-daily-status/
git commit -m "feat(backend): scope documents, alerts, parcel-daily-status by organization_id"
```

---

## Task 19: Backend — DashboardService scoped by org

**Files:**
- Modify: `backend/service/src/dashboard/dashboard.service.ts`
- Modify: `backend/service/src/dashboard/dashboard.controller.ts`

The dashboard service runs aggregate queries. Each subquery touches `trips`, `bale_productions`, `fuel_logs`, etc. Add `AND organization_id = ${orgId}::uuid` to every subquery's WHERE clause.

- [ ] **Step 1: Update `getOverview(orgId)`**

Find the big SQL in `getOverview()` and add org filter to every sub-SELECT:

```typescript
async getOverview(orgId: string | null): Promise<DashboardOverview> {
  const orgFilter = orgId !== null
    ? sql` AND organization_id = ${orgId}::uuid`
    : sql``;
  const result = await this.drizzleProvider.db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM trips
       WHERE status IN ('loading','loaded','in_transit','arrived','delivering')
         AND deleted_at IS NULL ${orgFilter}
      ) AS active_trips,
      (SELECT COALESCE(SUM(bale_count), 0)::int FROM bale_productions
       WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL ${orgFilter}
      ) AS todays_bales,
      -- ... repeat orgFilter for every sub-SELECT
  `);
  // ...
}
```

Apply the same `orgFilter` injection to `getProduction()`, `getCosts()`, `getAntiFraud()`, `getTrending()`, and any other methods in the service.

- [ ] **Step 2: Update DashboardController**

```typescript
@Get('overview')
getOverview(@CurrentUser() user: RequestUser) {
  return this.dashboardService.getOverview(user.organizationId);
}
// ... same for all other dashboard endpoints
```

- [ ] **Step 3: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/dashboard/
git commit -m "feat(backend): scope dashboard aggregates by organization_id"
```

---

## Task 20: Backend — SyncService scoped by org

This is critical. The mobile app pushes mutations and pulls data. We need:
1. INSERT mutations: stamp `organization_id` from the caller's JWT
2. UPDATE/DELETE mutations: guard that the record belongs to the caller's org
3. Pull: add org filter to all table SELECTs

**Files:**
- Modify: `backend/service/src/sync/sync.service.ts`
- Modify: `backend/service/src/sync/sync.controller.ts`

- [ ] **Step 1: Update `push(mutations, callerId, orgId)` signature**

```typescript
async push(mutations: SyncMutation[], callerId: string, orgId: string | null): Promise<SyncResult[]> {
```

Inside `applyMutation`, update the INSERT branch to inject `organization_id`:

```typescript
if (mutation.action === 'insert') {
  const dataWithVersion = { ...mutation.data, sync_version: 1 };
  // Stamp organization_id for tables that have it (all syncable tables except sync_idempotency)
  if (orgId !== null && SYNCABLE_TABLES.has(mutation.table)) {
    (dataWithVersion as Record<string, unknown>).organization_id = orgId;
  }
  // ... rest of existing INSERT logic unchanged
}
```

For UPDATE and DELETE, add an org-guard check after the record exists check. Before applying the UPDATE/DELETE, verify:

```typescript
if (orgId !== null) {
  const guardResult = await this.drizzleProvider.db.execute(
    sql`SELECT organization_id FROM ${sql.raw(`"${mutation.table}"`)}
        WHERE id = ${mutation.recordId}::uuid LIMIT 1`,
  );
  const rows = guardResult as unknown as { organization_id: string }[];
  if (rows.length && rows[0].organization_id !== orgId) {
    throw new BadRequestException(
      `Record ${mutation.recordId} does not belong to caller's organization`,
    );
  }
}
```

- [ ] **Step 2: Update `pull(tables, callerId, orgId)` signature**

```typescript
async pull(tables: Record<string, number>, callerId: string, orgId: string | null) {
```

Inside the per-table loop, add org filter:

```typescript
const orgFilter = orgId !== null
  ? sql` AND organization_id = ${orgId}::uuid`
  : sql``;

const result = await this.drizzleProvider.db.execute(
  sql`SELECT * FROM ${sql.raw(`"${table}"`)}
      WHERE sync_version > ${sinceVersion} ${ownerFilter}${softDeleteFilter}${orgFilter}
      ORDER BY sync_version ASC
      LIMIT 1000`,
);
```

- [ ] **Step 3: Update SyncController to pass orgId**

```typescript
@Post('push')
async push(@Body() body: SyncPushRequest, @CurrentUser() user: RequestUser) {
  const results = await this.syncService.push(body.mutations, user.id, user.organizationId);
  return { results, serverTime: new Date().toISOString() };
}

@Post('pull')
pull(@Body() body: SyncPullRequest, @CurrentUser() user: RequestUser) {
  return this.syncService.pull(body.tables, user.id, user.organizationId);
}
```

- [ ] **Step 4: Build, verify, commit**

```bash
./strawboss.sh typecheck backend
git add backend/service/src/sync/
git commit -m "feat(backend): scope sync push/pull by organization_id"
```

---

## Task 21: Backend — Full typecheck + dev start

Before touching the frontend, make sure the entire backend compiles and starts cleanly.

- [ ] **Step 1: Full typecheck**

```bash
./strawboss.sh typecheck backend
```

Expected: 0 errors.

- [ ] **Step 2: Start dev and hit a test endpoint**

```bash
./strawboss.sh dev
# In another terminal:
curl -s http://localhost:3001/api/v1/health | jq .
```

Expected: `{ "status": "ok" }`.

- [ ] **Step 3: Test org-scoped endpoint with a real token**

Log in via the admin web, grab the token from the browser devtools (Application → Cookies → supabase session), then:

```bash
TOKEN="<paste jwt here>"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/v1/machines | jq 'length'
```

Expected: returns machine list (scoped to the default org). No 401/403.

- [ ] **Step 4: Commit if any small fixes were needed**

---

## Task 22: Admin Web — Restructure routes under [slug]

Move every page from `apps/admin-web/src/app/(dashboard)/` to `apps/admin-web/src/app/[slug]/(dashboard)/`.

**Files:**
- All files under `apps/admin-web/src/app/(dashboard)/` move to `apps/admin-web/src/app/[slug]/(dashboard)/`
- Modify: `apps/admin-web/src/app/page.tsx` — becomes a login redirect

- [ ] **Step 1: Create the new directory structure**

```bash
mkdir -p apps/admin-web/src/app/\[slug\]/\(dashboard\)
```

- [ ] **Step 2: Move all dashboard files**

```bash
cp -r apps/admin-web/src/app/\(dashboard\)/. apps/admin-web/src/app/\[slug\]/\(dashboard\)/
```

Then verify the copy is complete:
```bash
diff -rq apps/admin-web/src/app/\(dashboard\)/ apps/admin-web/src/app/\[slug\]/\(dashboard\)/
```

Expected: no differences.

Remove the old directory:
```bash
rm -rf "apps/admin-web/src/app/(dashboard)"
```

- [ ] **Step 3: Update the root page.tsx to redirect to login**

Replace the entire content of `apps/admin-web/src/app/page.tsx`:

```typescript
// apps/admin-web/src/app/page.tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}
```

- [ ] **Step 4: Verify Next.js still compiles**

```bash
pnpm --filter @strawboss/admin-web build 2>&1 | tail -20
```

Expected: builds successfully. If there are import errors due to relative paths, fix them (they should be fine since the internal structure of `(dashboard)` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/app/
git commit -m "feat(admin-web): move dashboard routes under [slug] segment"
```

---

## Task 23: Admin Web — useOrgSlug hook + Sidebar prefix

**Files:**
- Create: `apps/admin-web/src/hooks/useOrgSlug.ts`
- Modify: `apps/admin-web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create useOrgSlug hook**

```typescript
// apps/admin-web/src/hooks/useOrgSlug.ts
'use client';
import { useParams } from 'next/navigation';

export function useOrgSlug(): string {
  const params = useParams();
  return params.slug as string;
}
```

- [ ] **Step 2: Update Sidebar.tsx to use dynamic slug-prefixed hrefs**

In `apps/admin-web/src/components/layout/Sidebar.tsx`:

1. Add the import at the top:
```typescript
import { useOrgSlug } from '@/hooks/useOrgSlug';
```

2. Change the static `navItems` array into a function that takes `slug`:

```typescript
function buildNavItems(slug: string) {
  return [
    { href: `/${slug}/operations`, icon: Activity, labelKey: 'nav.operations' as const },
    { href: `/${slug}/tasks`, icon: KanbanSquare, labelKey: 'nav.tasks' as const },
    { href: `/${slug}/trips`, icon: Truck, labelKey: 'nav.trips' as const },
    { href: `/${slug}/documents`, icon: FileText, labelKey: 'nav.documents' as const },
    { href: `/${slug}/reports`, icon: BarChart3, labelKey: 'nav.reports' as const },
    { href: `/${slug}/alerts`, icon: Bell, labelKey: 'nav.alerts' as const },
    { href: `/${slug}/map`, icon: Map, labelKey: 'nav.map' as const },
    { href: `/${slug}/farms`, icon: Tractor, labelKey: 'nav.farms' as const },
    { href: `/${slug}/parcels`, icon: Wheat, labelKey: 'nav.parcels' as const },
    { href: `/${slug}/deposits`, icon: Warehouse, labelKey: 'nav.deposits' as const },
    { href: `/${slug}/machines`, icon: Wrench, labelKey: 'nav.machines' as const },
    { href: `/${slug}/fuel-logs`, icon: Fuel, labelKey: 'nav.fuelLogs' as const },
    { href: `/${slug}/consumable-logs`, icon: Package, labelKey: 'nav.consumableLogs' as const },
    { href: `/${slug}/accounts`, icon: Users, labelKey: 'nav.accounts' as const },
  ] as const;
}

function buildBottomItems(slug: string) {
  return [{ href: `/${slug}/settings`, icon: Settings, labelKey: 'nav.settings' as const }] as const;
}
```

3. Inside the `Sidebar` component, add:
```typescript
const slug = useOrgSlug();
const navItems = buildNavItems(slug);
const bottomItems = buildBottomItems(slug);
```

4. Update the `active` detection — the `pathname.startsWith(item.href)` logic still works since the href now includes the slug.

- [ ] **Step 3: Also update any hardcoded links in `(dashboard)/layout.tsx`**

Check `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx` for any hardcoded paths (e.g. redirect to `/login`) — these should still point to `/login` which is correct.

- [ ] **Step 4: Build and verify**

```bash
pnpm --filter @strawboss/admin-web build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/hooks/useOrgSlug.ts apps/admin-web/src/components/layout/Sidebar.tsx
git commit -m "feat(admin-web): add useOrgSlug hook and prefix sidebar links with slug"
```

---

## Task 24: Admin Web — Dashboard layout org guard

The `[slug]/(dashboard)/layout.tsx` needs to verify that the authenticated user actually belongs to the org in the URL. If not, redirect them to their own org.

**Files:**
- Modify: `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx`

- [ ] **Step 1: Add org verification to dashboard layout**

In the existing layout, the `useEffect` already checks for a valid session. Extend it to also verify slug match:

```typescript
void supabase.auth.getSession().then(({ data: { session } }) => {
  if (!active) return;
  if (!session) {
    router.replace('/login');
    return;
  }

  const appMeta = session.user.app_metadata as {
    role?: string;
    organization_slug?: string;
  };

  // super_admin can access any org's dashboard
  if (appMeta.role === 'super_admin') {
    setReady(true);
    return;
  }

  // For regular users: enforce that the URL slug matches their org
  const userSlug = appMeta.organization_slug;
  if (userSlug && userSlug !== params.slug) {
    router.replace(`/${userSlug}/`);
    return;
  }

  setReady(true);
});
```

You'll need to read `params.slug` — add it to the component:

```typescript
import { useParams } from 'next/navigation';
// ...
const params = useParams<{ slug: string }>();
```

- [ ] **Step 2: Build and verify**

```bash
pnpm --filter @strawboss/admin-web build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add "apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx"
git commit -m "feat(admin-web): add org-slug guard to dashboard layout"
```

---

## Task 25: Admin Web — Login redirect to org slug

After successful login, redirect to `/${orgSlug}/` instead of `/`.

**Files:**
- Modify: `apps/admin-web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Replace the post-login `router.push('/')` with org-aware redirect**

Find the line `router.push('/')` in the `handleSubmit` function and replace the block starting at `signInWithPassword`:

```typescript
const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({
  email,
  password: authPassword,
});

if (authError) {
  setError(authError.message);
  setLoading(false);
  return;
}

// Read org info from the JWT app_metadata (injected by Supabase hook)
const appMeta = signInData.session?.user.app_metadata as {
  role?: string;
  organization_slug?: string;
} | undefined;

if (appMeta?.role === 'super_admin') {
  router.push('/super-admin');
  return;
}

const orgSlug = appMeta?.organization_slug;
if (!orgSlug) {
  setError('Contul tău nu are o organizație asignată. Contactează administratorul.');
  setLoading(false);
  return;
}

router.push(`/${orgSlug}/`);
```

- [ ] **Step 2: Build and verify**

```bash
pnpm --filter @strawboss/admin-web build 2>&1 | tail -20
```

- [ ] **Step 3: Manual test**

Start dev server (`./strawboss.sh dev`), navigate to `http://localhost:3000/login`, log in with an existing admin user. Verify the redirect goes to `http://localhost:3000/strawboss/` (not `/`).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/app/\(auth\)/login/page.tsx
git commit -m "feat(admin-web): redirect to /${orgSlug}/ after login"
```

---

## Task 26: Admin Web — Super-admin section

The super-admin needs a minimal dashboard to list orgs and create new ones.

**Files:**
- Create: `apps/admin-web/src/app/super-admin/(dashboard)/layout.tsx`
- Create: `apps/admin-web/src/app/super-admin/(dashboard)/page.tsx`
- Create: `apps/admin-web/src/app/super-admin/(dashboard)/organizations/page.tsx`
- Create: `apps/admin-web/src/app/super-admin/(dashboard)/organizations/new/page.tsx`

- [ ] **Step 1: Create super-admin layout**

```typescript
// apps/admin-web/src/app/super-admin/(dashboard)/layout.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) { router.replace('/login'); return; }
      const role = (session.user.app_metadata as { role?: string }).role;
      if (role !== 'super_admin') { router.replace('/login'); return; }
      setReady(true);
    });
    return () => { active = false; };
  }, [router]);

  if (!ready) return <div className="flex h-screen items-center justify-center" />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-4 bg-neutral-900 text-white">
        <span className="text-lg font-bold">Super Admin</span>
        <a href="/super-admin/organizations" className="text-sm hover:underline">Organizations</a>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create super-admin home page**

```typescript
// apps/admin-web/src/app/super-admin/(dashboard)/page.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SuperAdminHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/super-admin/organizations'); }, [router]);
  return null;
}
```

- [ ] **Step 3: Create organizations list page**

```typescript
// apps/admin-web/src/app/super-admin/(dashboard)/organizations/page.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import type { Organization } from '@strawboss/types';

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiClient.get<Organization[]>('/api/v1/organizations').then((data) => {
      setOrgs(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <button
          onClick={() => router.push('/super-admin/organizations/new')}
          className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
        >
          New Organization
        </button>
      </div>
      {loading ? (
        <p className="text-neutral-500">Loading...</p>
      ) : (
        <ul className="space-y-2">
          {orgs.map((org) => (
            <li key={org.id} className="rounded-lg border p-4">
              <div className="font-medium">{org.name}</div>
              <div className="text-sm text-neutral-500">/{org.slug}</div>
              <a
                href={`/${org.slug}/`}
                className="mt-1 inline-block text-xs text-primary hover:underline"
              >
                Open dashboard →
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create new organization form page**

```typescript
// apps/admin-web/src/app/super-admin/(dashboard)/organizations/new/page.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';

export default function NewOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/organizations', { name, slug });
      router.push('/super-admin/organizations');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'A apărut o eroare');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-6 text-2xl font-bold">New Organization</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="StrawKing SRL"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Slug (URL path)</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            required
            pattern="[a-z0-9-]+"
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            placeholder="strawking"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Dashboard URL: nortiauno.com/<strong>{slug || 'slug'}</strong>/
          </p>
        </div>
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Organization'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Build and verify**

```bash
pnpm --filter @strawboss/admin-web build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/app/super-admin/
git commit -m "feat(admin-web): add super-admin section with organizations CRUD"
```

---

## Task 27: Create first super_admin account

The `super_admin` user cannot be created via the normal admin UI (which scopes to an org). It must be created directly in Supabase Auth.

- [ ] **Step 1: Create super_admin user via Supabase Dashboard**

Go to Supabase Dashboard → Authentication → Users → "Add user".
- Email: `superadmin@nortiauno.com` (or any email)
- Password: a strong password (not a PIN)
- Click "Create user"

Then go to Authentication → Users → find the user → Edit → set `app_metadata`:
```json
{ "role": "super_admin" }
```

- [ ] **Step 2: Insert into public.users**

```sql
INSERT INTO users (id, email, username, pin, full_name, role, is_active, locale, organization_id)
VALUES (
  '<paste-supabase-auth-user-id-here>'::uuid,
  'superadmin@nortiauno.com',
  'superadmin',
  NULL,
  'Super Admin',
  'super_admin',
  true,
  'ro',
  NULL  -- super_admin has no org
);
```

Run via: `psql $DATABASE_URL -c "<above SQL>"`

- [ ] **Step 3: Verify login**

Start dev, navigate to `http://localhost:3000/login`, log in with the super_admin email + password. Verify redirect goes to `http://localhost:3000/super-admin`. Verify the organizations list shows "StrawBoss".

- [ ] **Step 4: Commit nothing** (DB changes are not committed; document the procedure instead)

---

## Task 28: Add a second organization end-to-end test

This verifies that the full isolation actually works.

- [ ] **Step 1: Create a second organization via super-admin UI**

Log in as super_admin, go to `/super-admin/organizations/new`, create:
- Name: `StrawKing` 
- Slug: `strawking`

- [ ] **Step 2: Create a new admin user for strawking**

Since the admin-users API requires a JWT with `organizationId`, temporarily use a raw psql INSERT to create the org's first admin, then let them create the rest:

```sql
-- Get strawking's org ID first:
SELECT id FROM organizations WHERE slug = 'strawking';
-- Then in Supabase Dashboard, create Auth user for strawking-admin, and:
INSERT INTO users (id, email, username, pin, full_name, role, is_active, locale, organization_id)
VALUES (
  '<strawking-admin-auth-id>'::uuid,
  'admin@strawking.ro',
  'strawking.admin',
  '1234',
  'Admin StrawKing',
  'admin',
  true,
  'ro',
  (SELECT id FROM organizations WHERE slug = 'strawking')
);
```

- [ ] **Step 3: Log in as strawking admin — verify isolation**

Log in with the strawking admin. Verify:
1. Redirect goes to `http://localhost:3000/strawking/`
2. Machines list is empty (strawking has no machines yet)
3. Parcels list is empty

Manually try to access `http://localhost:3000/strawboss/machines` — the layout guard should redirect you back to `/strawking/`.

- [ ] **Step 4: Add a machine to strawking and verify it doesn't appear in strawboss**

Create a machine as strawking admin. Then log in as strawboss admin and verify the machine list does NOT include the strawking machine.

---

## Task 29: Final typecheck + production build

- [ ] **Step 1: Full monorepo typecheck**

```bash
./strawboss.sh typecheck all
```

Expected: 0 errors.

- [ ] **Step 2: Full build**

```bash
./strawboss.sh build all
```

Expected: all packages build cleanly.

- [ ] **Step 3: Production build**

```bash
./strawboss.sh prod
```

Verify containers start, navigate to `https://nortiauno.com/login`, verify redirect to `https://nortiauno.com/strawboss/`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Option B multi-tenant organizations implementation"
```

---

## Post-Implementation Checklist

- [ ] Supabase Dashboard: re-save the JWT hook (Authentication → Hooks → Custom Access Token → re-activate `public.custom_access_token_hook`) after migration 00036 is deployed
- [ ] Verify all existing users in `public.users` have `organization_id = '00000000-0000-0000-0000-000000000001'` (the default strawboss org)
- [ ] Verify mobile app still syncs correctly (no client-side changes required — org context is from JWT)
- [ ] Check `nginx/conf.d/10-nortiauno.com.conf` — no path changes needed since Next.js handles all routes under the same container
- [ ] Document the new organization onboarding procedure (Tasks 27–28 pattern) for future clients

---

## What does NOT change

- **Mobile app (`apps/mobile`)**: No code changes. The user's JWT already carries `organization_id`; the backend now uses it. The sync protocol is transparent to the mobile client.
- **RLS policies**: Not touched. Option B enforces isolation at the application layer only.
- **`packages/api` React Query hooks**: No changes. Hooks call the backend; the backend reads org context from the JWT automatically.
- **nginx config**: No changes. All routes are still served by the same Next.js container.
