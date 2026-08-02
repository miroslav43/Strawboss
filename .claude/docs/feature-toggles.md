---
type: doc
title: "Per-Organization Feature Toggles"
created: 2026-07-31
updated: 2026-07-31
tags: [doc, features, backend, admin-web, mobile, multi-tenant]
status: mature
related:
  - "[[architecture]]"
  - "[[backend]]"
  - "[[admin-web]]"
  - "[[mobile]]"
  - "[[packages-types]]"
  - "[[database]]"
  - "[[scripts]]"
---

# Per-Organization Feature Toggles

A `super_admin` can switch modules/features off for one tenant. As of `e275b3c` (2026-07-31) the
system is **57/57 wired**: every switchable key in the registry actually gates something, and every
backend write route is either decorated or on an explicit, reasoned exemption list. Introduced across
PR #28/#29/#30 (merged to `main` before this doc existed) and completed by two follow-up commits on
`feat/features-stage3`.

**The rule that makes this safe:** a disabled feature blocks the corresponding WRITE paths. Every READ
path (history, reports, documents) stays open — a disabled feature must never make existing data
unreachable or make a report lie. This is a **product gate, never a security gate**: auth, the trip
state machine, task assignments, sync push/pull, idempotency, org scoping, soft deletes, uploads,
profile and `/fleet/checkin` are not in the registry and never will be.

## The Three Layers

```
REGISTRY (packages/types/src/features.ts)   what features EXIST, and their defaults
OVERRIDES (organizations.feature_overrides) what one org CHANGED — sparse, usually {}
RESOLUTION (resolveDisabledFeatures)        defaults <- overrides <- dependency closure
```

**Storage is sparse on purpose.** `organizations.feature_overrides` (migration `00093`, JSONB, `NOT
NULL DEFAULT '{}'`) holds only deviations, e.g. `{"costs.fuel": false}`. Effective value = `override ??
default`. Every registry entry ships `defaultEnabled: true` — typed as the **literal** `true`, so
writing `false` is a compile error. A feature added to the registry six months from now needs no
backfill: every existing org resolves it from the default. The inverse — a `false` default — would
silently switch that feature off for every existing org the instant the code deploys. "Off for new
customers" is `FEATURE_PRESETS.new_org`, applied only at org-creation time, never a default.

**Fail-open is structural, not a code path.** The wire format is the *disabled* keys only
(`resolveDisabledFeatures` returns `FeatureKey[]`). An empty array means "everything on", so a client
that never received the list — a phone booting offline, an APK from three releases ago — behaves like a
fully-enabled one. `isFeatureEnabled(disabled, key)` returns `true` for any key it does not recognise,
which is what lets an old mobile build survive a registry that has grown since it shipped.

**Keys are forever.** `<module>.<leaf>`, lowercase snake. Renaming a key silently re-enables that
feature for every org that had it off, because the stored override no longer matches anything. Add and
deprecate; never rename. `aux.autocomplete` was **removed** (not renamed) in `d141fb8` — safe only
because it was never `wired`, so the API rejected every write to it and no org could hold an override.

## Registry Shape (`packages/types/src/features.ts`)

10 top-level modules (`FEATURE_MODULES`), each also a `FeatureKey` in its own right: `bales`, `geo`,
`depot`, `costs`, `documents`, `aux`, `portals`, `messaging`, `analytics`, `roles`. 47 leaf keys hang
off them in `FEATURE_KEYS` (the array is the source of the `FeatureKey` union type, so a typo in
`@RequireFeature('costs.feul')` is a compile error).

`FeatureDef` fields per key:

| Field | Meaning |
|---|---|
| `defaultEnabled` | Always the literal `true` — see above. |
| `dependsOn` | Closure inputs. If ANY resolves disabled, so does this key. Module membership is modelled as `dependsOn: ['<module>']`, no special-casing in the resolver. |
| `surfaces` | `'web' \| 'mobile' \| 'api' \| 'jobs'` — informational, rendered in the console as "affects: web / mobile". |
| `gatesJobs` | BullMQ queues this feature gates wholesale for a disabled org. Only queues that are *purely* this feature's work — hygiene queues (sync-cleanup, gps-retention, stale-plan-sweep, presence-deadman, geofence-check, ota-deploy) are never listed. Queues serving several features (`trip-autocomplete`) are checked per-record inside the processor instead. |
| `uiSwitch` | `false` → the row is a dependency anchor only, renders no switch (only `roles`: a master toggle there would read as "no new accounts of any kind"). API rejects writes to `uiSwitch: false` keys. |
| `uiOnly` | `true` → no server-side gate exists or can exist: everything behind it is a READ. Hides a control/tab/step — genuinely useful, but NOT a commercial boundary; data stays reachable over the API. Console labels these (`superAdmin.features.uiOnly` badge) so nobody believes they revoked access. 7 keys: `geo.draw_mobile`, `depot.weighing`, `depot.inventory`, `costs.receipt_photos`, `costs.report`, `analytics.report_operators`, `analytics.export`. |
| `wired` | Required (not optional) — forces an explicit answer when a feature is added. The console renders only wired switches; the API rejects writes to the rest. A module row is `wired: true` only once **every** one of its leaves is (mechanically enforced, see Invariants below). Now 57/57. |

## Resolution (`resolveDisabledFeatures`)

```ts
resolveDisabledFeatures(overrides: FeatureOverrides = {}): FeatureKey[]
```

Registry defaults ← org overrides ← dependency closure, returning **only the disabled keys**. Unknown
keys in `overrides` (an org toggled something a later release removed) are ignored — the resolver
iterates the registry, not the stored object. The closure is a bounded fixed-point loop (bounded by key
count) so a bad `dependsOn` cycle terminates instead of hanging a request; a unit-equivalent invariant
in `check-features.mjs` asserts the graph is acyclic and convergent.

`isFeatureEnabled(disabled: readonly string[], key: string): boolean` takes plain `string[]` on
purpose, not `FeatureKey[]` — the caller is often an old mobile build or a newer server registry, and
narrowing the parameter would make tolerance itself a type error at exactly the boundary where it's the
point.

## Presets (`FEATURE_PRESETS` / `applicablePreset`)

Commercial presets are **buttons in the super-admin console, not a runtime entity** — there is no
`plans` table, no `plan_id`. Applying one just writes the override set once;
`organizations.plan_label` (migration `00093`) records which button was pressed for display only, and
no code branches on it.

- `new_org` — what the org-creation flow writes (aux/portals/messaging off, several document/role
  leaves off). Deliberately *not* the registry default (see the safety argument above).
- `basic` — documents/aux/portals/messaging/analytics modules off + a few leaves.
- `pro` — `messaging.sms`, `analytics.fraud`, `portals.transporter_role` off.
- `enterprise` — `{}` (pure registry defaults). Stored as `{}`, not a full all-true map.

`applicablePreset(preset)` translates a preset — written against the *full* registry — into keys the
API currently accepts. An earlier version dropped unwired keys outright; because presets switch whole
**modules** off and a module is `wired` only once every leaf is, that silently discarded most of what a
preset meant (Basic left four of ten modules fully enabled). Fixed: an unwired module row now expands
into whichever of its own leaves *are* wired, so the preset's intent survives partial rollout instead
of vanishing. `uiSwitch: false` anchors are still dropped. `check-features.mjs` asserts every module a
preset names is actually reached by it (Basic disables 31 features today).

## Backend Enforcement

### `FeaturesGuard` + `@RequireFeature` (`backend/service/src/features/`)

Third global guard, registered after `AuthGuard` and `RolesGuard`. `AuthGuard` folds
`organizations.feature_overrides` into the same `users LEFT JOIN organizations` lookup it already runs
on every authenticated request (one extra column, resolved once per 60s cache miss) — so `FeaturesGuard`
costs one array lookup and zero I/O. It must not inject anything request-scoped, or a request-scoped
guard appended after the static ones would silently reorder past it.

```ts
@RequireFeature('costs.fuel')      // WRITES ONLY — @Post/@Put/@Patch/@Delete
@Post('fuel-logs')
```

- Gates by the endpoint's **real path**, not which module conceptually owns the data (`register_load`
  is `TripsController`, not `BaleLoadsController` — decorating the wrong one leaves every phone writing
  freely while the admin UI shows the feature off).
- `super_admin` has `organizationId === null` and no flags of its own — confined to org-management
  endpoints by `RolesGuard` (no super_admin bypass there), so this is not a hole.
- No `request.user` (an `@Public()` route) → fails **open** at the guard. The org is only knowable once
  the service resolves it from a slug or a one-time token — enforcement moves in-service instead (see
  `FeaturesService.assertEnabledForOrg` below).

### `FeaturesService` (`features.service.ts`)

- **Kill switch**: `STRAWBOSS_ORG_FEATURE_FLAGS_ENABLED` env var (default on, `=== 'false'` opts out).
  Off → every org resolves to zero disabled features, i.e. the whole system degrades to pre-feature
  behaviour. Logged at boot. Must be declared in `docker-stack.yml` — a bare `service update
  --env-add` is silently reverted by the next `stack deploy`.
- `resolve(overrides)` — used by `AuthGuard`'s already-fetched join.
- `getDisabledForOrg(orgId)` — for callers with no `request.user` (device check-in, public portal).
  Per-org in-memory cache, 60s TTL + generation-token invalidation (see `FeaturesCacheService`), so ~30
  phones checking in every 60s cost no extra query. A missing/soft-deleted org resolves to "nothing
  disabled" rather than throwing — this runs on paths that already validate the org for their own
  reasons.
- `assertEnabledForOrg(orgId, feature)` — enforcement for `@Public()` routes. Call **immediately** after
  the org is resolved and **before** any INSERT/UPDATE (e.g. `TripRequestsService` gates
  `aux.field_pickup` before the one-time machine INSERT, so a rejection never strands an orphan truck).
- `setOverrides(orgId, dto, actor)` — writes the override set and an audit row per changed key inside
  one transaction, `SELECT ... FOR UPDATE` on the org row first (two super-admins/tabs saving
  concurrently used to silently revert each other with **no audit trace** — the one thing a
  cross-tenant kill-switch must never lose). Overrides are normalized to sparse form before storage (a
  value equal to the registry default is dropped), so an org left on defaults always reads back `{}`.
  Bumps the cross-replica generation counter and clears the local per-org cache after commit.
- `listChanges(orgId)` — audit history, newest first, joined to `users.full_name`.

### `FeaturesCacheService` — cross-replica invalidation (`features-cache.service.ts`)

Production runs two backend replicas behind nginx round-robin with independent 60s TTL caches; without
cross-replica invalidation, a toggle would read on/off/on to the same browser for ~55s (worse than a
plain delay — it reads as a broken switch). A single Redis key (`sb:flags:gen`) is a **monotonic
counter**, polled at most every 2s and read synchronously (`currentGeneration()` never blocks a request
— it returns the last known value and kicks a background refresh). Pub/sub was rejected: the shared
Redis client uses `maxRetriesPerRequest: 1` and swallows errors, so a subscriber that missed its
reconnect would drop messages permanently and undetectably; a polled counter self-heals on the next
read. `bump()` (called after every write) does a synchronous `INCR` so the replica that made the change
sees it immediately, not after the poll window. Fails open throughout — Redis unreachable degrades to
pure-TTL behaviour, never to "everything disabled".

### `SuperAdminFeaturesController` (`super-admin-features.controller.ts`)

Dedicated controller, not folded into `OrganizationsController`, specifically so the cross-tenant
kill-switch can never end up reachable by a forgotten per-method decorator — the whole controller
carries a class-level `@Roles(super_admin)`. `:orgId` comes from the URL because `super_admin` sessions
have `organizationId === null`.

- `GET /api/v1/super-admin/organizations/:orgId/features` — returns **raw** overrides (not the resolved
  set); the console computes the dependency closure client-side for a live cascade preview before
  saving.
- `PUT /api/v1/super-admin/organizations/:orgId/features` — validated by `updateOrgFeaturesSchema`
  (`@strawboss/validation`).

## Admin Web Consumption

- **`useFeatures()`** (`src/hooks/useFeatures.ts`) — reads `disabled` off the same `['profile']` query
  every page already fetches (`GET /profile` → `features.disabled`), zero extra requests. `isEnabled`
  returns `true` for everything before the profile resolves — hiding-then-revealing would visibly
  reshuffle the sidebar and flash "unavailable" at fully-entitled users. `ready` is exposed separately
  for callers where acting on the wrong assumption is unsafe.
- **`FeatureRouteGuard`** (`src/components/layout/FeatureRouteGuard.tsx`) — this app has no
  `middleware.ts`; every guard is a client layout. Hiding a sidebar link is not enough on its own (a
  bookmark or history entry walks straight past it), so this redirects (`router.replace`, not `push` —
  Back must not bounce) to `/command-center` once `ready` and the current path maps to a disabled
  feature via `navFeatureForPath` (derived from the sidebar's own item list, so a page can never be
  hidden from the menu while staying reachable by URL).
- **Super-admin console** — `apps/admin-web/src/app/super-admin/(dashboard)/organizations/[id]/page.tsx`
  renders the full registry tree with live cascade preview; `uiOnly` rows carry a badge
  (`superAdmin.features.uiOnly` + hint) so an operator can't mistake "hides a control" for "revokes
  access".
- **`ExportButton`** (`src/components/shared/ExportButton.tsx`, new) — one shared component replaced
  eleven independent export triggers (7 report tabs, 2 in the reports page, PDF, transporter XLSX) all
  gated on `analytics.export`. Gating them one by one was eleven chances to miss one, and a missed one
  leaks exactly the capability the flag withholds. Renders nothing when disabled (not a greyed control)
  rather than inviting a support ticket.
- Report tabs carry the flag that owns them (`ConnectedHoursTab`/`DepotReportTab`/`FarmReportTab`/
  `FieldReportTab`/`KmPerOperatorTab` on `analytics.report_operators`). `machineProduction` and
  `kmPerTruck` deliberately stay outside `analytics.report_operators` — they're per-machine, and that
  flag exists specifically for orgs that must not track individual operators.

## Mobile Consumption

- **`useFeaturesStore`** (`src/stores/features-store.ts`) — Zustand + `persist` to its own
  `expo-secure-store` key (`strawboss-features`), separate from `auth-store` so a flag write can never
  corrupt the persisted session. Persisted (not memory-only) because `AuthGate` can mark the app ready
  from a cold, offline boot with no request — flags must already be on disk or the phone would start a
  shift knowing nothing. `MAX_PERSISTED_BYTES = 1800`: past that, persists `{disabled: []}` (fail open)
  rather than a silently truncated list. Delivered via `/fleet/checkin` and `/profile` response fields.
- **`useIsFeatureEnabled(key)`** — reactive; **`isFeatureEnabledNow(key)`** — non-reactive, for
  background tasks/sync code outside React.
- **`featureTabOptions(enabled, remainingTabs)`** — `{href: null}` idiom (same one used for
  `parcel/[parcelId]`, `confirm-delivery`) to hide a `<Tabs.Screen>` while keeping it deep-linkable. Has
  a **last-tab guard**: below `remainingTabs < 2` the tab stays visible rather than shipping an app
  whose only tab is Profile — the backend still refuses the writes either way.
- Wired examples (mobile — `e275b3c`):
  - `depot.weighing` → `(deposit)/confirm-delivery.tsx` derives `effectiveScaleBroken = scaleBroken ||
    !weighingEnabled` and threads it through validation, the payload and the JSX. Hiding just the
    inputs would have left `canSubmit` permanently false — the depot operator could never confirm a
    delivery again. The server already accepts a weightless delivery on `scaleBroken`, so no endpoint
    changed.
  - `depot.inventory` → `index` is both the `(deposit)` group's initial route and the inventory screen,
    so the tab is hidden **and** the screen redirects to `/(deposit)/trips` (`<Redirect>`) — the shape
    `(geofence-maker)` already used.
  - `costs.receipt_photos` → `FuelEntryFlow.tsx`'s step list is now `stepsFor(photosEnabled)`, derived
    rather than a fixed array, so dropping the photo step needs no index arithmetic; only the three
    `goToStep('station-photo')` call sites needed rewriting.
  - `geo.draw_mobile` → only the entry FABs on `(geofence-maker)/map.tsx` are gated. With the entry
    point unreachable, `drawMode` stays `null` and the point-by-point controls and both create modals
    are dead by construction. The tab itself is **not** hidden — the screen is still a valid read
    surface showing existing parcels/depots.

## Invariants (`scripts/check-features.mjs`)

Dependency-free Node script (this repo has no test runner). Run after `./strawboss.sh build packages`:

```bash
node scripts/check-features.mjs
```

10 registry invariants (untouched org resolves to 0 disabled; every default is `true`; every key has a
definition and vice versa; every `dependsOn` target exists; the dependency graph is acyclic; every leaf
reaches its module; switching a module off cascades to all its leaves; an unknown key reads as enabled;
a module is `wired` only when every leaf is; every preset-named module is actually reached by it) plus
**backend write-route coverage**: it walks every `*.controller.ts` under `backend/service/src`, flags
every `@Post/@Put/@Patch/@Delete` route, and requires each to carry `@RequireFeature(...)` **or** be
listed in the script's `EXEMPT` map with a reason — `CORE` (would strand trips/brick an org/lock out
the console itself) or `IN-SERVICE` (a `@Public()` route gated inside the service instead, e.g. `sync`,
`admin-users` role toggles, the beneficiary/public-portal controllers). This mechanical check, not
review discipline, is what keeps the gate complete — an ungated write route with no listed reason fails
the build. Current state: 139 write routes, 57/57 keys wired, 12/12 invariants held.

## Wired Backend Gates Reference

| Key | Site | Enforcement shape |
|---|---|---|
| `documents.comanda` | `ComandaProcessor.process` + `TransporterController` | Guard decorator on the controller route; job-side **quiet return** (not throw) — a throw would feed BullMQ retry and land in `failed`, noise for a decision that will never succeed. |
| `aux.field_pickup` | `TripRequestsService` (in-service, not the controller — the route also confirms ordinary depot pickups) | `assertEnabledForOrg`, called **before** the one-time machine INSERT. |
| `analytics.fraud` | `AlertsService.createFromDraft` (fraud category) + `createBaleMismatchAlert` | Reuses the `analytics.alerts` lookup already made; quiet return — caller already completed the trip. |
| `geo.auto_transitions` | `GeofenceService`, per-assignment loop in the fleet-wide sweep job | `continue`, never throw — one job serves every org; gated at the very top because `resolveTransition` writes `geofence_events` inside its own transaction and the hysteresis machine reads them back, so gating lower would desync `wasInside`. |
| `messaging.email` / `messaging.sms` | `ResendMessagingService.sendEmail`/`sendSms` | Gated **after** `insertRow`, then `markFailed` with a legible reason — so `/messages` shows *why* nothing went out instead of silence. Required threading `orgId` into two SMS call sites in `TripsService` (`sendDriverAssignedSms`, arrival-CMR link) that previously passed only `tripId`; without it the gate reads no org and fails open exactly there. |

## Deploy Safety

1. `defaultEnabled: true` is the literal type — a `false` default cannot compile.
2. `resolveDisabledFeatures({})` (an untouched org) is asserted to return `[]` by
   `check-features.mjs`.
3. Post-deploy verification (from the migration's own header):
   `SELECT count(*) FROM organizations WHERE feature_overrides <> '{}'::jsonb;` — expect `0` on first
   deploy.
4. Kill switch `STRAWBOSS_ORG_FEATURE_FLAGS_ENABLED=false` degrades the whole system to pre-feature
   behaviour (everything enabled everywhere), never the reverse.

## Database (migration `00093_org_feature_overrides.sql`)

- `organizations.feature_overrides JSONB NOT NULL DEFAULT '{}'` + a `jsonb_typeof(...) = 'object'`
  CHECK constraint (a scalar/array here would make the resolver silently read every key as `undefined`
  — "everything on" at best, a crashed `AuthGuard` path at worst).
- `organizations.plan_label TEXT` (≤ 64 chars) — cosmetic only.
- `organization_feature_changes` — append-only audit table, one row per **changed key** (not per save):
  `organization_id`, `feature_key`, `old_enabled` (nullable — `NULL` means "was on the registry
  default"), `new_enabled`, `actor_user_id`/`actor_role`, `reason`, `created_at`. `organizations` isn't
  in the 11-table generic audit-trigger list (`00023`) and `audit.interceptor.ts` is declared but never
  bound, so without this table a cross-tenant kill-switch would leave no trace. RLS enabled with **no**
  permissive policy — same server-authoritative posture as `machine_last_positions`/
  `outbound_messages`/`geocode_cache`; the backend connects as table owner and bypasses RLS, nothing
  reads this over PostgREST.
- No index on `feature_overrides` itself — it's read only by `organizations.id` (already the PK), once
  per `AuthGuard` cache miss.
