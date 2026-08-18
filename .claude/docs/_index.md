---
type: meta
title: "StrawBoss Docs Index"
created: 2026-05-25
updated: 2026-08-18
tags: [meta, index]
status: mature
---

# StrawBoss Docs Index

This vault is the canonical knowledge base for the StrawBoss monorepo. Start with [[hot]] for current load-bearing context, then drill into the layer-specific docs.

## Entry Points

- [[hot]] — what's load-bearing **right now**. Read first in every session.
- [[log]] — chronological log of doc changes (auto-appended by `/strawboss-sync-docs`).
- [[architecture]] — top-level system overview, all layers + how they connect.

## Layers

| Layer | Doc | Surface |
|---|---|---|
| Backend | [[backend]] | NestJS 11 + Fastify, `/api/v1/*`, Drizzle ORM, BullMQ jobs |
| Admin Web | [[admin-web]] | Next.js 15 App Router, TanStack Query, Supabase Realtime, Leaflet maps |
| Mobile | [[mobile]] | Expo SDK 54, offline-first SQLite + sync queue, geofence, FCM |
| Database | [[database]] | PostgreSQL + PostGIS on Supabase Cloud, migrations 00001–00097, RLS |
| Sync | [[sync-protocol]] | Push/pull protocol, idempotency keys, sync_version delta |
| Feature Toggles | [[feature-toggles]] | Per-org registry, resolver/presets, FeaturesGuard, super-admin console |
| Infrastructure | [[infrastructure]] | Docker Compose, nginx, Let's Encrypt, Redis, Winston logs |
| Scripts | [[scripts]] | `strawboss.sh` orchestrator + scripts/_lib.sh dispatcher |

## Shared Packages

| Package | Doc | Purpose |
|---|---|---|
| `@strawboss/types` | [[packages-types]] | TypeScript interfaces + enums (zero deps) |
| `@strawboss/validation` | [[packages-validation]] | Zod schemas mirroring every type |
| `@strawboss/domain` | [[packages-domain]] | Pure business logic, XState trip machine, fraud/reconciliation |
| `@strawboss/api` | [[packages-api]] | Shared data layer, ApiClient, 28 React Query hook files |
| `@strawboss/ui-tokens` | [[packages-ui-tokens]] | Design tokens, Tailwind preset, RN helpers |

## Cross-cutting Topics

- **Trip lifecycle** → state machine in [[packages-domain]]; consumers in [[backend]] + [[mobile]]; persistence in [[database]].
- **Offline sync** → protocol in [[sync-protocol]]; mobile producer in [[mobile]]; backend consumer in [[backend]]; idempotency table in [[database]].
- **Auth & RLS** → Supabase JWT verification in [[backend]]; RLS policies in [[database]]; role gates in [[mobile]] + [[admin-web]].
- **Background jobs** → BullMQ queues in [[backend]] (alert-evaluation, reconciliation, cmr-generation, farmtrack-sync, sync-cleanup).
- **GPS track noise filtering** → kinematic + skeleton-consistency cleaning in [[backend]] ("GPS Noise Filtering / Route Cleaning"); fix-source tagging producer (`'task'`/`'checkin'`) in [[mobile]]; `machine_location_events.source` column in [[database]].
- **Per-org feature toggles** → registry in [[packages-types]]; enforcement in [[backend]]; console + route guard in [[admin-web]]; store + tab/step gating in [[mobile]]; storage in [[database]]; invariant script in [[scripts]]; full system in [[feature-toggles]].
- **i18n / locale (`ro`/`en`/`hu`)** → SSOT (`SUPPORTED_LOCALES`, `Locale`, `normalizeLocale`) in [[packages-types]]; server runtime i18n + `RequestUser.locale` in [[backend]]; catalogs + `useLocaleFormat`/`LangToggle` + parity gate in [[admin-web]]; catalogs + compile-time `CatalogShape` parity in [[mobile]]; `users.locale` is unconstrained `TEXT`, no migration needed to add a language, see [[database]].

## Adding a New Doc

1. Create `.claude/docs/<topic>.md` with full frontmatter (`type, title, created, updated, tags, status`).
2. Add an entry to this file under the right section.
3. Add wikilinks from related docs (`[[<topic>]]`).
4. Append a `[YYYY-MM-DD] save | new doc` line to [[log]].
5. Run `/claude-obsidian:wiki-lint` (over `.claude/docs/` vault) to verify.

## Conventions

- All docs have `type: doc` (or `meta` for index/hot/log).
- Cross-references use `[[stem]]` wikilinks (path-qualified only when filename collision).
- `updated:` field is bumped whenever a doc receives a non-trivial edit (the `/strawboss-sync-docs` skill should do this automatically).
- `status:` values: `seed`, `developing`, `mature`, `snapshot`, `deprecated`.
