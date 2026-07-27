---
type: doc
title: "Backend Service (backend/service)"
created: 2026-04-16
updated: 2026-07-27
tags: [doc, backend, layer, nestjs, drizzle, bullmq]
status: mature
related:
  - "[[architecture]]"
  - "[[database]]"
  - "[[sync-protocol]]"
  - "[[packages-domain]]"
  - "[[packages-types]]"
  - "[[packages-validation]]"
  - "[[packages-api]]"
---

# Backend Service (`backend/service`)

NestJS 11 + Fastify 5 REST API. All routes under `/api/v1/`. Database access via Drizzle ORM + postgres.js. Background jobs via BullMQ + Redis.

Entry point: `backend/service/src/main.ts` -- boots a `NestFastifyApplication`, sets global prefix `api/v1`, configures CORS, listens on `PORT` (default 3001). Enables graceful shutdown via `app.enableShutdownHooks()` + `process.on('SIGTERM'/'SIGINT')` → `await app.close()`, which drains in-flight HTTP requests and fires `onModuleDestroy` on all modules (closes BullMQ workers). Required for zero-downtime Swarm rolling deploys; pairs with `stop_grace_period` in `docker-stack.yml`.

---

## Module Structure

The `AppModule` (`src/app.module.ts`) imports 42 feature modules (plus dev-only `DevModule` outside production):

| Module | Path | Purpose |
|---|---|---|
| `AppLoggerModule` | `src/logger/logger.module.ts` | Winston factory with daily-rotate-file transports (`logs/web/{all,error,warn,info,flow,http,debug}/`) |
| `HealthModule` | `src/health/` | Public liveness endpoint |
| `ConfigModule` | `src/config/config.module.ts` | `@nestjs/config` with Zod env validation (`src/config/env.validation.ts`) |
| `DatabaseModule` | `src/database/database.module.ts` | `DrizzleProvider` -- singleton postgres.js + Drizzle ORM connection. `public client` exposes the raw postgres.js instance for reserved-connection work (e.g. advisory locks). Pool capped: `max: 8, idle_timeout: 20, connect_timeout: 10` for 2 Swarm replicas on the Supabase session-mode pooler (~16 steady, ~24 peak during rolling deploy). |
| `AuthModule` | `src/auth/auth.module.ts` | Global module exporting `AuthGuard` and `RolesGuard` |
| `ParcelsModule` | `src/parcels/` | CRUD for parcels (fields/plots) |
| `MachinesModule` | `src/machines/` | CRUD for trucks, balers, loaders |
| `TaskAssignmentsModule` | `src/task-assignments/` | Daily task planning, board views, bulk create |
| `TripsModule` | `src/trips/` | Trip lifecycle (10 state transitions) + create/list |
| `BaleLoadsModule` | `src/bale-loads/` | Bale loads per trip |
| `BaleProductionsModule` | `src/bale-productions/` | Baler production logs + stats |
| `FuelLogsModule` | `src/fuel-logs/` | Fuel consumption logs + stats |
| `ConsumableLogsModule` | `src/consumable-logs/` | Twine/consumable logs + stats |
| `DocumentsModule` | `src/documents/` | Document registry + CMR sub-module |
| `CmrScansModule` | `src/cmr-scans/` | Scanned *paper* CMR upload (loader photo scan or admin override), stored as `document_type: 'cmr_scan'`; see [[backend#CMR Scans]] |
| `AlertsModule` | `src/alerts/` | Alert CRUD + BullMQ alert-evaluation processor |
| `AuditModule` | `src/audit/` | `AuditInterceptor` + `AuditService` for change tracking |
| `SyncModule` | `src/sync/` | Mobile push/pull sync + cleanup processor |
| `ReconciliationModule` | `src/reconciliation/` | Bale/fuel reconciliation + BullMQ processor |
| `LocationModule` | `src/location/` | GPS position reporting and route history |
| `AdminUsersModule` | `src/admin-users/` | User management (admin-only CRUD) |
| `DashboardModule` | `src/dashboard/` | Aggregate KPI queries |
| `JobsModule` | `src/jobs/` | BullMQ queue registration + `JobSchedulerService` |
| `TrpcModule` | `src/trpc/` | tRPC context/router (secondary API layer) |
| `ProfileModule` | `src/profile/` | Self-service profile CRUD + password change |
| `FarmsModule` | `src/farms/` | Farm entity CRUD |
| `ParcelDailyStatusModule` | `src/parcel-daily-status/` | Per-parcel per-day status (done/not-done) |
| `DeliveryDestinationsModule` | `src/delivery-destinations/` | Delivery deposit CRUD with geofence boundaries |
| `NotificationsModule` | `src/notifications/` | Expo push token registration + send + geofence confirm |
| `GeofenceModule` | `src/geofence/` | ST_Contains polling + enter/exit detection |
| `MobileLogsModule` | `src/mobile-logs/` | Ingest batched NDJSON log entries from mobile devices; persists optional `deviceId` in Winston meta |
| `DepositInventoryModule` | `src/deposit-inventory/` | Depot list and inventory for `depot_manager` role (Plan C) |
| `ReportsModule` | `src/reports/` | Extended report queries (KmPerTruck, etc.) |
| `FleetModule` | `src/fleet/` | Device registry, OTA releases/deployments, FCM acceleration push; see [[backend#Fleet Module (OTA)]] |
| `BeneficiariesModule` | `src/beneficiaries/` | Beneficiary (customer) CRUD + daily-PIN portal identity; `findByIdWithOrg` backs the authenticated transporter form |
| `TripRequestsModule` | `src/trip-requests/` | "Curse" intake: public PIN portal + admin confirm/cancel + beneficiary saved-record CRUD; see [[backend#Trip Requests]] |
| `TransporterModule` | `src/transporter/` | Web-only `transportator` (external hauler) role: assigned-beneficiary request form, saved records, read-only ledger, aviz/CMR/comandă on own requests; see [[backend#Transporter Module]] |
| `GeocodeModule` | `src/geocode/` | Reverse-geocode cache (Nominatim) feeding "near \<locality\>" on machine cards; exported to `LocationModule`; see [[backend#Geocode Service]] |

Global providers (registered in `AppModule.providers`):

- `APP_GUARD: AuthGuard` -- JWT verification on every route (unless `@Public()`)
- `APP_GUARD: RolesGuard` -- role enforcement via `@Roles()` decorator
- `APP_INTERCEPTOR: LoggingInterceptor` -- assigns `X-Request-Id`, logs HTTP lines
- `APP_FILTER: AllExceptionsFilter` -- catches all exceptions, structured JSON error response

---

## Auth System

### JWT Verification (`src/auth/auth.guard.ts`)

`AuthGuard` peeks at the JWT header `alg` field to route verification:

- **HS256** (legacy): verifies with `SUPABASE_JWT_SECRET` via `jose.jwtVerify()`
- **ES256 / RS256** (modern): verifies via JWKS fetched from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` using `jose.createRemoteJWKSet()`

Role extraction order: `payload.app_metadata.role` -> `payload.user_role` -> `payload.role`

**Organization hydration fallback**: if the JWT hook omits org claims, `hydrateOrganizationFromJwt()` loads them from the DB before attaching the user to the request.

The resolved user is attached to `request.user` as `RequestUser { id, email, role }`.

### Decorators

- `@Public()` (`src/auth/auth.guard.ts`) -- sets `isPublic` metadata, skips AuthGuard
- `@Roles(...roles)` (`src/auth/roles.guard.ts`) -- restricts to listed `UserRole` values; throws `ForbiddenException` if mismatch
- `@CurrentUser()` (`src/auth/current-user.decorator.ts`) -- parameter decorator extracting `RequestUser` from request

---

## Endpoint Inventory

### Health (`src/health/health.controller.ts`)
- `GET /health` -- @Public -- returns `{ status: 'ok', timestamp }`

### Trips (`src/trips/trips.controller.ts`)
- `GET /trips` -- any authenticated -- list with filters: status, driverId, truckId, sourceParcelId, loaderOperatorId, dateFrom, dateTo, `include=refs` (opt-in enrichment), `isAuxiliary=true|false` (opt-in split; absent = both, unchanged), `search` (ILIKE over trip number, truck plate/code, driver incl. `external_driver_name` for aux, destination, parcel). `dateFrom`/`dateTo` are format-guarded: a bare `YYYY-MM-DD` is treated as a Romania-local calendar day, anything else (e.g. mobile's full UTC instant) passes through unmodified -- rewriting both the same way would truncate the mobile shape into the wrong day. `limit` is deliberately **not** accepted -- Command Center and `machines/[machineId]` have always sent one that the backend ignored and rely on getting the full (1000-row-capped) window to filter client-side; honouring it would truncate before their filter runs and silently drop, e.g., a truck `in_transit` since Monday.
- `GET /trips/:id` -- any authenticated -- single trip by ID
- `POST /trips` -- @Roles(admin, dispatcher) -- create a new trip (status: planned)
- `DELETE /trips/:id` -- @Roles(admin, dispatcher) -- soft delete. For an **auxiliary** trip this is "un-plan", not delete: transactionally soft-deletes the trip, soft-deletes the originating truck task, and clears `trip_requests.trip_id`, dropping the request back to "Confirmată -- neplanificată" so it can be re-assigned to another truck (e.g. after a breakdown). Own-fleet deletes are unchanged. Prevents the previous bug where deleting an aux trip left `trip_requests.trip_id` pointing at a soft-deleted row, permanently bricking the request (the loader's phone showed "no active aux trip" forever).
- `POST /trips/:id/start-loading` -- @Roles(admin, loader_operator) -- planned -> loading
- `POST /trips/:id/complete-loading` -- @Roles(admin, loader_operator) -- loading -> loaded (validates bale_loads > 0; saves `loaderSignatureUrl`)
- `POST /trips/register-load` -- @Roles(admin, loader_operator) -- atomic "Camion plin" entry point (find/create today's trip, insert a `bale_loads` row, transition to `loaded`, idempotent on `idempotencyKey`). The loader's signature is **never trusted from the client**: `TripsService.resolveLoaderSignature()` reads `users.signature_specimen_url` server-side and uses the client's copy only as a fallback (and only if it already matches `SIGNATURE_URL_PATTERN` from `@strawboss/validation`) -- a mismatch is logged, not rejected. This replaced a strict-allowlist DTO field that had silently 400'd the one loader operator using this screen for six days after the 08.07 security audit tightened it, because the phone only ever echoes back a cached specimen URL, never draws a fresh one.
- `GET /trips/auxiliary/at-loader/:loaderMachineId` -- any authenticated -- open auxiliary trips (`planned`/`loading`) assigned to a loader machine, independent of GPS proximity (the external truck carries no device, so it never appears in the trucks-at-loader query); drives the mobile loader's AUX cards. Optional `dateFrom` query param (`TripsService.listAuxiliaryForLoader`) scopes to `created_at >= dateFrom` -- mobile passes `startOfDayRomaniaISO()` (same boundary `useMyTrucksToLoad` uses for the "Încărcări" tab) so a trip stalled in `loading` or left open across days stops lingering on the tab forever.
- `POST /trips/:id/depart` -- @Roles(admin, driver) -- loaded -> in_transit (records departure odometer; queues CMR stage 1). **No driver signature is collected** -- `driver_signature_url` stays NULL and `departSchema`/`DepartDto` drop the field entirely (not just optional), so an already-queued bad payload from an older build is silently stripped instead of permanently 400'ing the transition (which used to wedge the trip on `loaded` and cascade "transition not allowed" onto every later step).
- `POST /trips/:id/arrive` -- @Roles(admin, driver) -- in_transit -> arrived (calculates odometer distance)
- `POST /trips/:id/start-delivery` -- @Roles(admin, driver) -- arrived -> delivering
- `POST /trips/:id/confirm-delivery` -- @Roles(admin, driver) -- delivering -> delivered (records gross weight, computes net from truck tare; saves `deterioratedBalesCount`). Accepts `scaleBroken: true` ("Livrează fără cântărire") for a depot with no working scale, mirroring `confirmDepotDelivery`'s pattern: `gross_weight_kg`/`tare_weight_kg` stay NULL and `scale_broken` is stamped `true` instead of requiring a weight. Otherwise `grossWeightKg` is required (>0) and `tareWeightKg > grossWeightKg` is rejected (`tare_exceeds_gross`), never silently clamped, because a clamp would write `net=0` onto a legally binding CMR.
- `POST /trips/:id/confirm-depot-delivery` -- @Roles(admin, depot_manager) -- the depot-manager's self-confirm path (Plan C): confirms delivery at a manned depot the depot manager is assigned to (`users.assigned_delivery_destination_id`); also supports `scaleBroken`.
- `POST /trips/:id/complete` -- @Roles(admin, driver) -- delivered -> completed (queues CMR stage 2). **No receiver signature is collected** in the driver's self-confirm flow -- `receiver_signature_url`/`receiver_signed_at` stay NULL and `completeSchema`/`CompleteDto` no longer accept/require the field. Fixes the same class of bug as `/depart`: a failed binary signature upload (weak signal) could never pass `signatureUrlSchema`, permanently stuck-retrying `complete` in the mobile sync queue's quadratic backoff.
- `POST /trips/:id/cancel` -- @Roles(admin) -- any pre-completed -> cancelled
- `POST /trips/:id/force-status` -- @Roles(admin) -- admin-only manual status override, bypasses the state machine. When the target status asserts the goods are on the truck (`loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`) and the trip has no `bale_loads` row yet, the caller must supply a source (`parcelId` XOR `sourceDepotId`) and `baleCount`, or the server rejects with machine-readable `load_required`. When supplied, a real `bale_loads` row is inserted (stamped with `user.id` as `operator_id`) and the trip's `source_parcel_id`/`source_depot_id` is set to match -- this is the actual stock deduction (parcel remaining is derived as `SUM(bale_productions) - SUM(bale_loads)`) and keeps reports/dashboard (which join on `trips.source_parcel_id`) in sync with parcel stock. Previously wrote only the status, producing phantom "loaded" trips that moved zero stock.
- `POST /trips/:id/dispute` -- @Roles(admin) -- delivered -> disputed
- `POST /trips/:id/set-destination` -- @Roles(admin, driver) -- sets `destinationId` on a trip (`{ destinationId: uuid }`)
- `POST /trips/:id/resolve-dispute` -- @Roles(admin) -- disputed -> completed or delivered
- `POST /trips/:id/next-iteration` -- @Roles(admin, loader_operator) -- create next iteration trip for same course (Plan C multi-iteration)
- `POST /trips/:id/recall-loader` -- @Roles(admin, dispatcher) -- send loader-recall push when truck is idle (Plan C)

**SECURITY (fixed 2026-07-14, `ef7ec6e`)**: `GET /trips` and `GET /trips/:id` used to `SELECT t.*`, which shipped `public_sign_token` -- the one-time bearer secret that lets an account-less external driver sign an auxiliary trip's CMR through a public link -- to **every authenticated user**, since these routes carry no `@Roles`. Both endpoints now use an explicit column projection; `public_sign_token` was also removed from the `Trip` type and the admin-web trip mapper so it cannot be reintroduced silently.

**`trips.destination_id` integrity (fixed 2026-07-14, `ef7ec6e` + migration `00085`)**: added by migration 00051 to mirror `task_assignments.destination_id`, but no creation path ever set it, so it was NULL on every trip -- silently killing `confirmDepotDelivery()` (threw `no_destination`), the depot-manager sync pull (zero rows), and the `depot_manager_*` RLS policies (matched nothing). Now set on `create`, `registerLoad`, the next-iteration spawn, and both arms of `autoUpsertFromTruckTask` (own-fleet only -- an auxiliary trip delivers to the customer's yard, not a depot, so it deliberately stays NULL). `destination_coords` is now emitted as `{lat, lon}` via `json_build_object` instead of raw PostGIS EWKB hex. A depot rename now propagates to non-terminal trips' denormalized `destination_name`/`destination_address` via a new trigger (terminal trips are left alone -- a CMR is a legal document and must not be retroactively rewritten). Migration 00085 backfilled existing trips, skipping any trip already `in_transit`/`arrived`/`delivering` so a driver mid-delivery is never switched onto the depot-operator wait screen underneath them.

**Stale-plan auto-cancel** (`trips/stale-plan-sweep.processor.ts`, `750b2bf`): a `planned` own-fleet trip never reaches a terminal status on its own, and the sync pull force-includes every non-terminal trip (`sync.service` `versionFilter`), so an abandoned plan stayed glued to the driver's/loader's phone forever. A new BullMQ repeating job (`stale-plan-sweep`, queue `QUEUE_STALE_PLAN_SWEEP`, daily **00:15 Europe/Bucharest**) calls `TripsService.sweepStalePlannedTrips()`, which cancels own-fleet (`is_auxiliary = false`) `planned` trips whose planned day (latest live `task_assignments.assignment_date`, falling back to the trip's creation date in Romania tz) is strictly before today, and soft-deletes their still-live `task_assignments` so the truck drops off the tasks board. Auxiliary/external pickups are deliberately left untouched -- they may legitimately wait days for the external truck.

### CMR (`src/documents/cmr/cmr.controller.ts`)
- `POST /trips/:tripId/generate-cmr` -- @Roles(admin, dispatcher) -- on-demand CMR PDF generation

### CMR Scans (`src/cmr-scans/`)

The *scanned paper* CMR -- the physical transport document the external driver brings, photographed by the loader at the end of an auxiliary load. Own `document_type: 'cmr_scan'`, deliberately distinct from the Puppeteer-generated `cmr` above (trip-scoped, `trip_request_id` NULL); the two coexist on the same trip without competing for a document slot. A leaf module (not a method on `TripsService`): the mobile route needs `UploadsService` + `DocumentsService`, `TripsModule` imports neither, and `TripRequestsModule` already imports `TripsModule`, so hanging it off either would need a `forwardRef`.

- `POST /cmr-scans/trip/:tripId` -- @Roles(admin, loader_operator) -- mobile: loader uploads the PDF built on-device from the document-scanner shots, addressed by trip
- `POST /cmr-scans/trip-request/:requestId` -- @Roles(admin, dispatcher) -- admin override: upload/replace the CMR straight from the trip-requests page
- `GET /cmr-scans/trip-request/:requestId` -- @Roles(admin, dispatcher) -- list scans filed against a request

Both writers funnel into `CmrScansService.attachScan()` -- the single place that decides how a scan is stored. "One scan per request" is enforced by retiring the previous `cmr_scan` document before inserting the replacement, both inside a transaction guarded by a per-request `pg_advisory_xact_lock(hashtext('cmr_scan:' + requestId))` so a loader auto-sync racing an admin override can't leave two active rows (or zero). An aux trip with no `trip_request_id` (shouldn't happen, but defensively handled) still keeps the PDF via a plain insert and logs a `winston.warn`, but can't light up the green button on the requests page. The freshly-inserted row is returned directly -- `DocumentsService.create()` now `RETURNING`s the camelCase column projection (not `*`) instead of the caller re-reading via `list()`, because a re-read filtered only by request/type could hand back a *different* trip's scan (leaking its metadata and signed link). `DocumentsService.create()` / `softDeleteByTripRequest()` both accept an optional Drizzle transaction executor so the retire+insert can run atomically.

`UploadsService.saveCmrScan()` (max `CMR_SCAN_MAX_BYTES` = 15 MB, vs 10 MB for `saveAviz()`; both share a `savePdf()` helper) sniffs the leading `%PDF-` magic bytes rather than trusting the client-declared MIME, and accepts an optional UUID-validated `scanId` as the storage filename (`cmr-scans/<uuid>.pdf`) so a sync-queue retry after an ambiguous upload failure overwrites the same blob instead of orphaning one; a non-UUID value is ignored and falls back to a random filename. `trip_requests` list rows (`TR_COLS` in `trip-requests.service.ts`) expose `hasCmrScan` (EXISTS on `documents.document_type = 'cmr_scan'`) alongside `hasAviz`, driving the green CMR-scan button on the admin requests page.

### Trip Requests (`src/trip-requests/`)

The "Curse" intake pipeline for an **auxiliary** (external) transport, born as a `trip_requests` row from one of two sources -- the public PIN portal (`public-portal.controller.ts`, beneficiary daily 4-digit PIN, rate-limited via `PinThrottleGuard`) or the authenticated `transportator` form (`transporter.controller.ts`, below) -- and later materialized into a real `trips` row once a dispatcher assigns a truck on the board.

- `GET /trip-requests` -- @Roles(admin, dispatcher) -- list, filters: status, search, dateFrom, dateTo, limit, offset
- `GET /trip-requests/:id` -- @Roles(admin, dispatcher) -- single request
- `POST /trip-requests/:id/confirm` -- @Roles(admin, dispatcher) -- `pending` -> `confirmed`; body `{ internalCode?, depotId?, parcelId? }`. Mints a one-time auxiliary `machines` row (`is_auxiliary: true`) for the external truck. The pickup source is **parcel XOR depot** (`6d3742c`) -- `source_parcel_id`/`source_depot_id` are stamped on the request and validated to belong to the request's org; this is the "field-sourced pickup" alternative to a depot pickup. Queues `QUEUE_MESSAGE_SEND` ('transport-confirmation') for the async email/SMS (see `messaging/transport-confirmation.processor.ts`), which for a field pickup now resolves the parcel's centroid/boundary-centroid coordinates (not just a label) so the route/map block renders (`d33951e`).
- `POST /trip-requests/:id/cancel` -- @Roles(admin, dispatcher) -- body `{ reason? }`. A `pending` request cancels freely. A **`confirmed`** request can now also be cancelled (`b26af58`), but *only* while it has no live trip -- refused with machine-readable `has_live_trip` otherwise (the UI matches on the code, telling the dispatcher to delete/un-plan the trip first). Cancelling a confirmed request also soft-deletes its one-time auxiliary truck, so it doesn't litter the fleet as a plannable phantom.
- `POST /trip-requests/:id/aviz` / `GET /trip-requests/:id/aviz` -- @Roles(admin, dispatcher) -- upload/list the delivery-note (aviz) PDF, `AVIZ_MAX_BYTES` cap.

**Live-trip read model** (`42dc117`): the list/detail query `LEFT JOIN LATERAL`s onto the live trip keyed on the **stable** direction, `trips.trip_request_id` (soft-delete-guarded inside the lateral), replacing the old reverse `trips.trip_id` pointer lookup, which was last-write-wins, never cleared on a soft-deleted trip, and carried no `deleted_at` guard -- it could render the trip number of a deleted trip. `tripCount` surfaces a `>1 trip` anomaly on a request instead of hiding it. Every numeric/date column in the shared projection (`TR_COLS`) is explicitly cast (`::float8`, `to_char(...)`) so the wire shape matches the declared TypeScript type regardless of which endpoint produced it (postgres.js only auto-parses a fixed set of type OIDs; NUMERIC and DATE were previously arriving as strings/Date objects that didn't match `Trip Requests` types).

### Transporter Module (`src/transporter/`, `UserRole.transportator`)

A new, **web-only** account type for external hauliers (mobile excludes it via `NON_FIELD_ROLES`). Every route is `@Roles(UserRole.transportator)` and org-scoped (`requireOrg`, fail-closed on a missing `organizationId`); anything touching a beneficiary additionally goes through `TransporterAssignmentsService.assertAssigned()` -- the authenticated analogue of the public portal's daily PIN, and the *real* boundary since the backend bypasses RLS.

- `GET /transporter/beneficiaries` -- the beneficiaries this transporter may act for (PIN-free projection -- `daily_pin` never reaches a transporter account)
- `GET`/`PUT /transporter/beneficiaries/:beneficiaryId/order-settings` -- per-beneficiary "comandă" settings (transport value, currency, payment term, bale count/dimensions, goods, loading locality/country, obs); `PUT` never touches `order_counter`
- `GET`/`POST`/`PATCH`/`POST .../delete` `/transporter/beneficiaries/:beneficiaryId/{contacts,trucks,drivers}[/:id]` -- saved-record CRUD (delegates to `BeneficiaryRecordsService`, shared with the public portal); delete is POST, not DELETE, mirroring the public-portal convention
- `POST /transporter/requests` -- submit a request on behalf of an assigned beneficiary (`createTransporterRequestSchema`) -- calls the shared `TripRequestsService.submitTransporterRequest()`
- `GET /transporter/requests` -- the transporter's own ledger, server-side filtered to `trip_requests.created_by_user_id === user.id` (new column, migration `00087`) -- a transporter never hits the unguarded `GET /trips`
- `GET`/`POST /transporter/requests/:id/aviz` and `/cmr` -- upload/view aviz + CMR-scan, only on the transporter's own requests (`tripRequests.assertCreatedBy` gate)
- `GET`/`POST /transporter/requests/:id/comanda` -- view / regenerate the transport-order PDF for the transporter's own request (see Comandă below); `POST` 400s with a Romanian hint if the beneficiary has no order settings configured

Admin management of the transporter <-> beneficiary assignment (`transporter_beneficiaries`, M:N) lives in `TransporterAdminController`, mounted on the `admin/users` base path (a second controller for the same prefix is fine in Nest):
- `GET /admin/users/:id/beneficiaries` -- @Roles(admin) -- list a transporter's assigned beneficiary ids
- `PUT /admin/users/:id/beneficiaries` -- @Roles(admin) -- set-replace the whole assignment set (`setTransporterBeneficiariesSchema`), atomically (hard delete + bulk insert in one transaction); validates the target is a `transportator` in-org and every beneficiary id belongs to the org

### Comandă (transport order) PDF (`src/documents/comanda/`)

Generates the "comandă" (transport order) PDF from a `trip_requests` row + its `beneficiary_order_settings`, via the same Puppeteer + Handlebars pipeline as the CMR (`comanda.hbs` template; SSRF-guarded request interception -- only `data:`/`about:`/`blob:` URLs are allowed to load). Stored via `UploadsService.saveComanda()` (`COMANDA_MAX_BYTES` = 5 MB) and registered as `document_type: 'comanda'` (migration `00088`).

- **Always generates** (`cb27a6b`), even if the beneficiary hasn't configured order settings yet -- commercial fields (price, goods, loading place, OBS) simply render blank until filled in on the Beneficiari tab; a `beneficiary_order_settings` row is auto-created with defaults if missing (so the running order counter has a home). The only hard no-op is a request with **no beneficiary at all** (the public 4-digit portal doesn't require one).
- Per-beneficiary **order counter** (`beneficiary_order_settings.order_counter`) is assigned exactly once and is idempotent across regeneration (`trip_requests.comanda_order_no` caches the assigned number).
- Auto-queued (best-effort, `attempts: 2`) via `QUEUE_COMANDA_GENERATION` (`ComandaProcessor`) at the end of `TripRequestsService.insertBeneficiaryRequest()` -- fires for both the public PIN portal and the authenticated transporter form.
- "One comandă per request" -- retires the previous `comanda` document (`softDeleteByTripRequest`) before inserting the new one, same pattern as CMR scans.

### Geocode Service (`src/geocode/geocode.service.ts`)

Reverse-geocode cache (`geocode_cache`, migration `00089`, RLS-on/service-role-only) feeding the tasks-page machine cards' "near \<locality\>" label. Exported by `GeocodeModule`, imported into `LocationModule`.

- Cache key: coordinate rounded to 3 decimals (~110 m), 90-day TTL (`CACHE_TTL_DAYS`).
- `attachLocalities(rows: MachineLastLocation[])` mutates `locality` in place for **fresh** positions only (reported within `MACHINE_ONLINE_WINDOW_MS`, currently 900 s) -- a parked/stale machine is left `null` rather than geocoded. Called from `LocationService.getLastKnownPositions()` (backs `GET /location/machines`).
- Cache misses are filled **asynchronously, off the request path** (fire-and-forget), capped at `FILL_CAP = 3` per call and spaced `NOMINATIM_SPACING_MS = 1100 ms` apart to respect Nominatim's ~1 req/s public-usage policy; a miss surfaces as `locality: null` and fills in for the next poll (the machine feed is polled every 30 s fleet-wide).
- Fully fail-safe: any DB or network error (including the `geocode_cache` table not existing yet, so the backend can deploy before the migration) is swallowed with a `logger.warn` -- `/location/machines` never breaks on a geocode failure.

`machines.service.ts` `list()` also now returns `assignedOperatorName`/`assignedOperatorAvatarUrl` (subqueries on `users.assigned_machine_id`, real uploaded avatar only -- no default/initials fallback) for the tasks-page available-machine cards (`d94050a`).

### Sync (`src/sync/sync.controller.ts`)
- `POST /sync/push` -- any authenticated -- push offline mutations (insert/update/delete) with idempotency
- `POST /sync/pull` -- any authenticated -- delta pull (records with sync_version > requested)
- `GET /sync/status` -- any authenticated -- last processed version per table for client

### Location (`src/location/location.controller.ts`)
- `POST /location/report` -- any authenticated -- store GPS ping (lat, lon, accuracy, heading, speed); also calls `ProfileService.touchLastSeen(operatorId)` best-effort (non-fatal) to refresh `users.last_seen_at` — keeps machine-bound operators "online" on the dashboard while their JS heartbeat is paused (backgrounded). See [[backend]] module deps: `LocationModule` imports `ProfileModule`.
- `POST /location/report/batch` -- any authenticated -- batch variant of `report`: body `{ reports: LocationReportDto[] }`, 1–30 items, for flushing the mobile offline outbox in one request. `LocationService.reportLocationBatch()` hoists the per-request work (assigned-machine lookup, org check, `touchLastSeen`, geofence nudge) to run once per batch instead of once per item, then does one multi-row `INSERT ... ON CONFLICT DO NOTHING`. Returns 204 even when every row was a duplicate. No `ZodValidationPipe`/`@strawboss/validation` schema exists for location bodies (matches the single endpoint's pattern — plain typed DTO + manual bounds checks in the service); the 1–30 size check and lat/lon range check are manual `BadRequestException`s in the service, same as `reportLocation`. Old app builds keep using the single endpoint unmodified during rollout.
- `GET /location/machines` -- @Roles(admin) -- last known position of all machines. Reads `machine_last_positions` (migration 00081, one row per machine, kept current by an `AFTER INSERT` trigger on `machine_location_events`) instead of a `SELECT DISTINCT ON` scan over full `machine_location_events` history — same output columns/org-scoping, no time window (a machine parked for weeks still shows its last fix). Rows are enriched with `locality` via `GeocodeService.attachLocalities()` (best-effort, see [[backend#Geocode Service]]).
- `GET /location/related-machines` -- any authenticated -- positions of machines sharing today's assignments (siblings via parent_assignment_id)
- `GET /location/machines/:machineId/route?from=...&to=...` -- @Roles(admin) -- GPS route history (up to 50,000 points)
- `GET /location/machines/:machineId/km-by-day?from=...&to=...` -- @Roles(admin) -- km driven per day (returns `KmByDayResponse`)
- `GET /location/loader-board/:loaderMachineId` -- @Roles(admin, loader_operator) -- the loader's work board (`51d3e5d`/`357f603`): trucks **assigned** to this loader (`trips.loader_id`, status `planned|loading|loaded`) with a `presence` badge (`here` within `radiusM` of the loader's last GPS fix / `enroute` / `loaded` / `unknown`) and `loadState`, plus trucks merely within GPS proximity (`getTrucksAtLoader`) that are **not** assigned (`nearbyUnassigned`). Optional `radiusM` (default 75 m) and `windowMinutes` (default 15) query params, coerced to `Number` and validated `Number.isFinite`. `windowMinutes` is bound as a SQL parameter (`${windowMinutes} * INTERVAL '1 minute'`), not `sql.raw()` -- an earlier revision interpolated it via `sql.raw()`, fixed same-day. Machine/parcel joins carry `deleted_at IS NULL` guards, matching `getTrucksAtLoader`.

### Profile (`src/profile/profile.controller.ts`)
- `GET /profile` -- any authenticated -- current user's profile
- `PATCH /profile` -- any authenticated -- update fullName, phone, locale, notificationPrefs
- `POST /profile/change-password` -- any authenticated -- change password

### Notifications (`src/notifications/notifications.controller.ts`)
- `POST /notifications/register-token` -- any authenticated -- register/update Expo push token
- `POST /notifications/confirm-parcel-done` -- @Roles(admin, baler_operator) -- mark assignment done + record bale production
- `POST /notifications/loader-recall-response` -- @Roles(loader_operator) -- loader's yes/no answer to a truck-idle recall prompt (Plan C)

**Recipient targeting hardening** (`d7c0430`, fixed after reports that "notifications went to everyone"): `NotificationsService.sendPush()` now stamps `recipientUserId` on the `data` payload of **every** push -- a single choke point covering all 18 call sites -- so the mobile client's `isPushForCurrentUser()` guard (new `push-recipient.ts`) can drop any push whose `recipientUserId` doesn't match the logged-in user (closes a shared-device stale-Expo-token leak; needs an OTA/APK release to take effect client-side). Also: `broadcast(kind: 'all')` with a **null** organization now throws `ForbiddenException` instead of blasting every org's accounts (previously fell through to `SELECT DISTINCT user_id FROM device_push_tokens` with no org filter at all); `sendTruckIdleAdminAlert` / `sendParcelLoadMismatchAlert` now no-op (with a `winston.warn`) on a null org instead of fanning out to every admin/dispatcher across every organization.

### Bale Productions (`src/bale-productions/bale-productions.controller.ts`)
- `GET /bale-productions` -- any authenticated -- list with filters (operatorId, parcelId, dateFrom, dateTo)
- `GET /bale-productions/stats` -- any authenticated -- aggregated stats (groupBy: operator/parcel/date)
- `POST /bale-productions` -- @Roles(baler_operator, admin) -- create production record

### Dashboard (`src/dashboard/dashboard.controller.ts`)
- `GET /dashboard/overview` -- any authenticated -- KPI: balesToday, activeTrips, tripsToday, activeMachines, pendingAlerts
- `GET /dashboard/production` -- any authenticated -- production statistics
- `GET /dashboard/costs` -- any authenticated -- fuel/consumable cost breakdown
- `GET /dashboard/trending` -- any authenticated -- daily bale/trip counts over recent window
- `GET /dashboard/anti-fraud` -- any authenticated -- fraud flag summary

### Documents (`src/documents/documents.controller.ts`)
- `GET /documents` -- any authenticated -- list (filter by tripId, documentType)
- `GET /documents/:id` -- any authenticated -- single document metadata
- `GET /documents/:id/download` -- any authenticated -- redirect to file URL

### Alerts (`src/alerts/alerts.controller.ts`)
- `POST /alerts` -- @Roles(admin) -- create alert manually
- `GET /alerts` -- any authenticated -- list (filter by category, severity, isAcknowledged)
- `GET /alerts/unacknowledged` -- any authenticated -- pending alerts only
- `PATCH /alerts/:id/acknowledge` -- @Roles(admin, dispatcher) -- acknowledge an alert

### Task Assignments (`src/task-assignments/task-assignments.controller.ts`)
- `GET /task-assignments` -- any authenticated -- list (filter by date, machineId, userId, status)
- `GET /task-assignments/board/:date` -- any authenticated -- kanban board view
- `GET /task-assignments/daily-plan/:date` -- any authenticated -- grouped daily plan (available / inProgress / done)
- `GET /task-assignments/by-machine-type/:date/:machineType` -- any authenticated -- filtered by machine type
- `POST /task-assignments` -- @Roles(admin, dispatcher) -- create single assignment
- `POST /task-assignments/bulk` -- @Roles(admin, dispatcher) -- batch create (array validated via Zod)
- `PATCH /task-assignments/:id/status` -- @Roles(admin, dispatcher) -- update status
- `PATCH /task-assignments/:id` -- @Roles(admin, dispatcher) -- update fields
- `POST /task-assignments/auto-complete` -- @Roles(admin, dispatcher) -- auto-complete past assignments before given date
- `DELETE /task-assignments/:id` -- @Roles(admin, dispatcher) -- soft delete

### Parcels (`src/parcels/parcels.controller.ts`)
- `GET /parcels` -- any authenticated -- list (filter by municipality, isActive)
- `GET /parcels/:id` -- any authenticated -- single parcel
- `GET /parcels/:id/bale-availability` -- any authenticated -- produced/loaded/available bale counts
- `POST /parcels` -- @Roles(admin) -- create parcel
- `PATCH /parcels/:id` -- @Roles(admin) -- update parcel (including boundary)
- `DELETE /parcels/:id` -- @Roles(admin) -- soft delete

### Machines (`src/machines/machines.controller.ts`)
- `GET /machines` -- any authenticated -- list (filter by machineType, isActive)
- `GET /machines/:id` -- any authenticated -- single machine
- `POST /machines` -- @Roles(admin) -- create machine
- `PATCH /machines/:id` -- @Roles(admin) -- update machine
- `DELETE /machines/:id` -- @Roles(admin) -- soft delete

### Farms (`src/farms/farms.controller.ts`)
- `GET /farms` -- any authenticated -- list all
- `GET /farms/:id` -- any authenticated -- single farm
- `POST /farms` -- @Roles(admin) -- create
- `PATCH /farms/:id` -- @Roles(admin) -- update
- `DELETE /farms/:id` -- @Roles(admin) -- soft delete

### Delivery Destinations (`src/delivery-destinations/delivery-destinations.controller.ts`)
- `GET /delivery-destinations` -- any authenticated -- list (filter by isActive)
- `GET /delivery-destinations/:id` -- any authenticated -- single
- `POST /delivery-destinations` -- @Roles(admin) -- create (with boundary for geofence)
- `PATCH /delivery-destinations/:id` -- @Roles(admin) -- update
- `DELETE /delivery-destinations/:id` -- @Roles(admin) -- soft delete

### Bale Loads (`src/bale-loads/bale-loads.controller.ts`)
- `GET /bale-loads` -- any authenticated -- list (filter by tripId, parcelId)
- `POST /bale-loads` -- @Roles(loader_operator, admin) -- create bale load record

### Fuel Logs (`src/fuel-logs/fuel-logs.controller.ts`)
- `GET /fuel-logs` -- any authenticated -- list (filter by machineId, dateFrom, dateTo)
- `GET /fuel-logs/stats` -- any authenticated -- aggregated fuel stats
- `POST /fuel-logs` -- @Roles(admin, baler_operator, loader_operator, driver) -- create

### Consumable Logs (`src/consumable-logs/consumable-logs.controller.ts`)
- `GET /consumable-logs` -- any authenticated -- list (filter by machineId, parcelId)
- `GET /consumable-logs/stats` -- any authenticated -- aggregated consumable stats
- `POST /consumable-logs` -- @Roles(admin, baler_operator, loader_operator, driver) -- create

### Admin Users (`src/admin-users/admin-users.controller.ts`)
- `GET /admin/users` -- @Roles(admin) -- list all users
- `POST /admin/users` -- @Roles(admin) -- create user
- `PATCH /admin/users/:id` -- @Roles(admin) -- update user
- `DELETE /admin/users/:id` -- @Roles(admin) -- deactivate (204)

### Parcel Daily Status (`src/parcel-daily-status/parcel-daily-status.controller.ts`)
- `GET /parcel-daily-status?date=...` -- any authenticated -- list status entries for a date
- `PUT /parcel-daily-status` -- @Roles(admin, dispatcher) -- upsert (parcelId + statusDate)
- `DELETE /parcel-daily-status?parcelId=...&date=...` -- @Roles(admin, dispatcher) -- remove entry (204)

### Mobile Logs (`src/mobile-logs/mobile-logs.controller.ts`)
- `POST /logs/mobile` -- any authenticated -- ingest NDJSON log entries (validated via `mobileLogIngestSchema`)

### Deposit Inventory (`src/deposit-inventory/deposit-inventory.controller.ts`)
- `GET /deposit-inventory/depots` -- any authenticated -- list depots for the caller's org (Plan C)
- `GET /deposit-inventory/:depotId` -- any authenticated -- inventory + incoming trips for a depot (org-scoped)

**Outbound stock subtraction** (`3f18963`): depot stock used to be inbound-only ("stock = all-time delivered", per the old in-code comment), even though `bale_loads.source_depot_id` (migration 00073) lets a loader load a truck straight out of a depot. `totalBales` is now `GREATEST(inbound - outbound, 0)`, where outbound sums `bale_loads.source_depot_id = depotId` (deleted-guarded, org-scoped) -- the same fix landed in `delivery-destinations.service.ts` and `reports.service.ts` wherever depot balance is computed. `received_in_period`/`arriving_now` stay inbound-only by design (they are flow, not balance). Numbers dropped after deploy because they had been overstated (one depot showed 1000 bales while holding 670).

### Profile Heartbeat
- `POST /profile/heartbeat` -- any authenticated -- updates `users.last_seen_at` to now (mobile calls every 30s, Plan C)

### Fleet — public (`src/fleet/fleet.controller.ts`)
- `POST /fleet/checkin` -- @Public -- device check-in / registration; see [[backend#Fleet Module (OTA)]]

### Fleet — super-admin (`src/fleet/fleet-admin.controller.ts`)
- `GET /super-admin/devices` -- @Roles(super_admin) -- list all registered devices with latest OTA state
- `GET /super-admin/devices/:id` -- @Roles(super_admin) -- single device
- `PATCH /super-admin/devices/:id` -- @Roles(super_admin) -- rename device or assign to org (`updateDeviceSchema`)
- `DELETE /super-admin/devices/:id` -- @Roles(super_admin) -- soft delete
- `GET /super-admin/devices/:id/ota-status` -- @Roles(super_admin) -- full OTA status history for a device (last 200 rows)
- `GET /super-admin/devices/:id/logs?level=&date=` -- @Roles(super_admin) -- device log viewer; reads mobile Winston log files, filters NDJSON lines by `deviceUuid` (last 1000 matching lines)
- `GET /super-admin/releases` -- @Roles(super_admin) -- list APK releases (newest first, max 500)
- `POST /super-admin/releases` -- @Roles(super_admin) -- upload APK (multipart/form-data, up to 250 MB; fields: `version`, `versionCode`, `changelog?`, `mandatory?` + file part `apk`; SHA-256 computed on ingest)
- `PATCH /super-admin/releases/:id` -- @Roles(super_admin) -- update release metadata (status, mandatory, changelog)
- `GET /super-admin/deployments` -- @Roles(super_admin) -- list deployments with per-state device counts
- `POST /super-admin/deployments` -- @Roles(super_admin) -- create deployment (`createDeploymentSchema`); immediate if no `scheduledAt`, otherwise queues a BullMQ delayed job
- `POST /super-admin/deployments/:id/cancel` -- @Roles(super_admin) -- cancel a deployment
- `PATCH /super-admin/devices/:id/tailscale` -- @Roles(super_admin) -- set `tailscale_desired` on a device; triggers best-effort FCM wake push so the device checks in quickly (`setDeviceTailscaleSchema`: `{ desired: boolean }`)
- `GET /super-admin/settings/tailscale` -- @Roles(super_admin) -- read masked global Tailscale settings (raw secrets never returned; fields: `tailscaleAuthKeySet`, `tailscaleOauthConfigured`, `tailscaleTailnet`, `tailscaleTag`, `tailscaleApkSet`, `updatedAt`)
- `PUT /super-admin/settings/tailscale` -- @Roles(super_admin) -- update global Tailscale settings (`updateTailscaleSettingsSchema`: `authKey`, `tailnet`, `oauthClientId`, `oauthClientSecret`, `tag`; send `''` to clear a field, omit to leave unchanged)
- `POST /super-admin/settings/tailscale-apk` -- @Roles(super_admin) -- upload the official Tailscale APK (multipart field `apk`, max 250 MB); stores at `{UPLOADS_ROOT}/tailscale/tailscale.apk`; records SHA-256 and size in `app_settings`; overwrites any previous APK; returns masked `AppSettings`

Note: `users.last_seen_at` is also refreshed via `POST /location/report` (Layer 1 presence). Machine-bound operators whose JS heartbeat is paused when backgrounded still stay "online" because their device foreground service continues to stream GPS. The two paths are independent; the GPS path is best-effort and never fails the location report.

---

## Sync Service (`src/sync/sync.service.ts`)

### Syncable tables
`trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `task_assignments`, `machines`, `parcels`

### Column allowlist
`ALLOWED_COLUMNS` maps each table to a `Set<string>` of permitted column names. `validateColumnName()` is called before any `sql.raw()` to prevent injection.

### Push flow
1. **Idempotency check**: `SELECT FROM sync_idempotency WHERE client_id + table_name + record_id + client_version` -- returns cached result if already processed
2. **Apply mutation**: `insert` (with `sync_version = 1`), `update` (increments `sync_version`), `delete` (soft-delete, increments `sync_version`)
3. **Record in `sync_idempotency`**: stores `server_version` and `result_data` for future dedup

### Pull flow
Delta sync: `SELECT * FROM "{table}" WHERE sync_version > {sinceVersion} ... LIMIT 1000`. Ownership scoping: trips are filtered by `driver_id` or `loader_operator_id`; bale_productions/fuel_logs/consumable_logs/bale_loads by `operator_id`.

### Cleanup (`src/sync/sync-cleanup.processor.ts`)
BullMQ processor on `sync-cleanup` queue. Deletes `sync_idempotency` records older than 30 days.

---

## Geofence Service (`src/geofence/geofence.service.ts`)

`checkMachinePositions()` runs every 2 minutes via the `geofence-check` BullMQ queue (plus an event-driven nudge on every fresh GPS report):

1. Fetches active assignments for today (`status IN ('available', 'in_progress')`)
2. Gets latest GPS from `machine_location_events` (within 10 minutes)
3. For each assignment, runs `ST_Contains(boundary, ST_MakePoint(lon, lat))` against the target parcel or delivery_destination
4. Compares with last `geofence_events` record for that machine+geofence pair
5. **Enter**: records event, updates assignment to `in_progress`, sends Expo push (`field_entry` or `deposit_entry`)
6. **Exit**: records event, sends `geofence_exit_confirm` push to baler operators (prompts bale count)

---

## CMR Generation (`src/documents/cmr/`)

Two-stage generation via BullMQ:

- **Stage 1** (at `depart`): `TripsService.depart()` queues `{ tripId, stage: 1 }`. Produces a partial PDF; document status set to `partial`.
- **Stage 2** (at `complete`): `TripsService.complete()` queues `{ tripId, stage: 2 }`. Produces the final PDF; document status set to `generated`.

- `CmrService` (`cmr.service.ts`): loads `cmr.hbs` Handlebars template at construction. `generateCmr(tripId, stage)` fetches trip + parcel + truck + driver + bale_loads, renders HTML, converts to PDF via Puppeteer (`headless: true, --no-sandbox`), stores base64 data URL. Stage 1 omits weight/arrival/delivery fields (only populated from stage 2 onward). **As of `5a8ce2a`/`b6beb2e` (2026-07-24), `trip.driver_signature_url` and `trip.receiver_signature_url` are always NULL** -- neither `/depart` nor `/complete` collects them anymore (see [[backend#Trips]]) -- so `driverSignatureUrl`/`receiverSignatureUrl` render blank on both stages; `loaderSignatureUrl` (resolved server-side from the loader's specimen, see `register-load`) is the only signature still on the document.
- `CmrProcessor` (`cmr.processor.ts`): BullMQ processor on `cmr-generation` queue, reads `job.data.stage` and calls `cmrService.generateCmr(tripId, stage)`
- On-demand override: `POST /trips/:tripId/generate-cmr` (`@Roles(admin, dispatcher)`).

---

## Fleet Module (OTA) (`src/fleet/`)

Manages the device registry and over-the-air APK updates for the mobile fleet.

### Files

| File | Role |
|---|---|
| `fleet.controller.ts` | Public `POST /fleet/checkin` endpoint (`@Public()`, no auth) |
| `fleet-admin.controller.ts` | All super-admin endpoints under `/super-admin/` (`@Roles(super_admin)`) |
| `fleet.service.ts` | Business logic: check-in, HMAC verify, OTA state machine, APK upload, deployments |
| `fleet-push.service.ts` | Optional FCM data-push acceleration (dynamic import of `firebase-admin`) |
| `ota-deploy.processor.ts` | BullMQ processor for `ota-deploy` queue — activates scheduled deployments |

### Device check-in (`POST /fleet/checkin`)

Called by the mobile app on startup, foreground, and after sync. Uses `deviceCheckinSchema` from `@strawboss/validation`.

- **First call** (unknown `deviceUuid`): registers the device; returns a `deviceTokenIssued` (HMAC token) that the app must store and present on every subsequent call.
- **Returning device**: must supply `deviceToken`; verified with `timingSafeEqual(HMAC-SHA256(SUPABASE_JWT_SECRET, deviceUuid), token)`.
- **Token-recovery, fail-CLOSED** (`536f6e4` + `9c0dfdd`): a known device checking in with **no** `deviceToken` is the register-once failure mode -- the server issued a token on first check-in but the device never persisted it (HTTP response lost, or SecureStore dropped it), bricking the device from the fleet forever otherwise. Recovery re-issues a token, but **only** when the submitted `androidId` is present and equals the `android_id` captured at registration -- a two-factor bearer check (`deviceUuid` + `android_id`) so a leaked/guessed `deviceUuid` alone cannot mint a token. An absent or mismatched second factor is a hard 401 (`UnauthorizedException`); so is a *present-but-wrong* `deviceToken`. A device whose stored `android_id` is itself unknown must instead be recovered by a super-admin soft-deleting its row so it re-registers cleanly.
- **OTA reports**: the payload may include an `otaReports[]` array reporting the current state of one or more deployments (`downloading | downloaded | installing | installed | failed`). The anti-skew rule prevents false `installed` confirmations: if the device's reported `versionCode` is lower than the release's `versionCode`, the state is clamped to `installing`.
- **Command reports**: the payload may include a `commandReports[]` array (`[{ commandId, status: 'success' | 'failure', error? }]`) reporting the outcome of previously issued `DeviceCommand`s (e.g. Tailscale up/down). Applied before `pendingCommand` is computed. Success sets `tailscale_applied = tailscale_desired`; failure records `tailscale_last_error`.
- **Response**: `{ deviceId, assignedOrgId, deviceTokenIssued?, pendingDeployment?, pendingCommand? }`. `pendingDeployment` is non-null when there is an active deployment targeting this device that it has not yet installed. `pendingCommand` is non-null when `tailscale_desired <> tailscale_applied`; see [[backend#Tailscale remote-access control]].

### OTA state machine (`device_ota_status.state`)

States (enum `ota_state`): `pending → notified → downloading → downloaded → installing → installed | failed`

The state row is created with `pending` on deployment activation. It transitions to `notified` the first time the device checks in and receives the pending deployment. The device drives the remaining transitions via `otaReports[]`. `installed` is only accepted when the device's `versionCode >= release.versionCode` (anti-skew guard).

### APK upload

APKs are stored under `{UPLOADS_ROOT}/apks/{uuid}.apk`. SHA-256 is computed on ingest via a streaming pass. The global `@fastify/multipart` 3 MB limit is overridden per-request to 250 MB via `req.file({ limits: { fileSize: 250 * 1024 * 1024 } })`. APK download URLs are served as HMAC-signed URLs via the same `signUploadUrl` mechanism as other uploads.

### Deployment fan-out (`target_kind`)

`all` — every non-deleted device; `org` — devices in a specific `organization_id`; `device_set` — explicit UUID array.

On activation, `device_ota_status` rows are inserted for all matching target devices (devices already at or above the release `versionCode` are immediately marked `installed`). Devices not yet in the table are handled lazily on their next check-in.

### Scheduled deployments (`QUEUE_OTA_DEPLOY`)

When `createDeploymentSchema.scheduledAt` is set, a BullMQ delayed job is added with `delay = scheduledAt - now()` and `jobId = ota-deploy-{deploymentId}`. `OtaDeployProcessor` processes it by calling `FleetService.activateDeployment()`. Negative delay is clamped to 0.

### FCM acceleration push (`fleet-push.service.ts`)

`FleetPushService` sends a data-only FCM push (`type: ota_checkin`) after deployment activation to prompt devices to check in sooner than their normal poll interval. `firebase-admin` is **not** a hard dependency — it is dynamically imported via a non-literal specifier (`const pkg = 'firebase-admin'; await import(pkg)`). If the `FIREBASE_SERVICE_ACCOUNT` env var is absent or the package is unavailable, the service logs once at `info` and becomes a no-op. **Poll is the authoritative delivery mechanism.**

The same low-level `sendDataWake()` also backs `sendPresenceWake()` (the presence dead-man wake, `type: presence_wake`, called from `fleet.service.ts`), which returns the list of tokens FCM reports as permanently invalid so the caller can prune `devices.push_token`. Pruning is deliberately conservative: a **404** (UNREGISTERED/NOT_FOUND) is always pruned; a **400** is only pruned when the response body specifically implicates the token (`message.token` field violation, `registration-token-not-registered`, `SENDER_ID_MISMATCH`, `UNREGISTERED`) — a bare `INVALID_ARGUMENT` is never pruned on its own, because FCM also returns that code for a malformed *message*, and treating it as token-dead would let a future payload-shape bug null the whole fleet's `push_token` in one pass, disabling the dead-man wake until every phone re-checks in.

### Presence cadence hierarchy (`@strawboss/types` `presence.ts`, `467fcae`)

Single source of truth for every "is this device/user online?" decision across admin-web, backend, and mobile -- fixes the web presence dot flapping grey while a phone was actually on, which was caused by three independent presence systems computing `now - lastSeen < window` client-side with windows that had drifted out of sync with the device's real report cadence. The invariant (each `<` is a deliberate safety margin):

```
C_awake (~120s) < W_green (150s) < S (240s) < R_max (~360s) < W_idle (420s) < ∞
```

- `C_awake` -- worst-case cadence of an awake, healthy phone: `DEVICE_CHECKIN_GATE_MS` (90 s) + a driver tick (55-60 s).
- `W_green` = `DEVICE_ONLINE_WINDOW_MS` (150 s) -- device shows green ("online"); must exceed `C_awake` so a healthy phone never flaps.
- `S` = `PRESENCE_DEADMAN_STALE_MS` (240 s) -- backend dead-man starts FCM-reviving; must exceed `W_green` so the dot turns amber *before* the wake fires.
- `R_max` (~360 s) -- worst-case revive+report = `S + PRESENCE_DEADMAN_RUN_MS` (90 s) + FCM/checkin slack.
- `W_idle` = `DEVICE_IDLE_WINDOW_MS` (420 s) -- device shows amber up to here; must exceed `R_max` so a phone the dead-man *can* revive never reaches red. Beyond it -> red = a full dead-man cycle failed = genuinely down.
- `USER_TOUCH_THROTTLE_MS` (45 s, per-user-per-replica `touchLastSeen` write throttle) and `USER_ONLINE_WINDOW_MS` (180 s) also live in this file.

Backend consumers: `ProfileService.TOUCH_THROTTLE_MS` and `FleetService.wakeStaleDeviceOwners()`'s default `staleMs` both import from this SSOT rather than hardcoding. `packages/api/src/client/server-clock.ts` (`serverNow()`) corrects for browser/server clock skew by reading the response `Date` header in `ApiClient`, so admin-web measures staleness against server time. See `apps/mobile/FLEET-BACKGROUND-ONLINE.md` for the mobile-side mirror of `DEVICE_CHECKIN_GATE_MS`/`HEARTBEAT_INTERVAL_MS`.

### Mobile log viewer (`GET /super-admin/devices/:id/logs`)

Reads Winston NDJSON log files under `logs/mobile/{level}/{YYYY-MM-DD}.log`, filters lines where `meta.deviceId` or top-level `deviceId` matches the device's `deviceUuid`. Returns the last 1000 matching lines. `date` must match `/^\d{4}-\d{2}-\d{2}$/` (path traversal guard). `level` is allow-listed to `all | error | warn | info | flow | debug | http`.

### Tailscale remote-access control

The fleet module implements a command-channel pattern so super-admins can toggle Tailscale on/off on individual devices without a persistent connection.

**Device fields** (columns on `devices`):

| Column | Type | Meaning |
|---|---|---|
| `tailscale_desired` | boolean | What the admin wants (toggled via `PATCH /super-admin/devices/:id/tailscale`) |
| `tailscale_applied` | boolean | What the device last successfully applied |
| `tailscale_online` | boolean | Whether Tailscale reports the device as online (updated by host sync script) |
| `tailscale_ip` | text | Tailscale IP address once connected |
| `tailscale_hostname` | text | Sanitized DNS label sent to the device in the `up` command |
| `tailscale_last_seen` | timestamptz | Last Tailscale heartbeat (from host sync) |
| `tailscale_last_error` | text | Last error message from a failed command |

**Command channel in check-in response**

`computePendingCommand(deviceId)` runs after OTA reports are applied. It issues a `DeviceCommand` only when `tailscale_desired <> tailscale_applied`:

- `action: 'down'` — returned immediately with no auth key; device runs `tailscale down`.
- `action: 'up'` — issued only to a device that has token-verified its `deviceToken` (the HMAC guard on check-in). Reads `app_settings` for Tailscale config, then:
  1. Calls `sanitizeHostname(device.name, deviceId)` — lowercases, replaces non-`[a-z0-9-]` runs with `-`, strips leading/trailing `-`; fallback `phone-<first-8-chars-of-deviceId>`.
  2. Eagerly writes `tailscale_hostname` to the DB so the host sync script can match the node.
  3. Calls `mintEphemeralAuthKey` if OAuth is configured (preferred); falls back to the shared `tailscale_auth_key` from `app_settings`.
  4. If no usable auth key exists at all, records `tailscale_last_error` and returns `null` (no command issued).
  5. Attaches a signed `tailscaleApk` URL + SHA-256 to the payload if `tailscale_apk_key` is set in `app_settings` (zero-touch install on Device-Owner phones).

The `DeviceCommand` returned in the check-in response carries a new `id` (`randomUUID()`) so the device can report back with `commandReports[{ commandId, status, error? }]`. On success, `tailscale_applied` is set to `tailscale_desired` and `tailscale_last_error` is cleared. On failure, only `tailscale_last_error` is updated.

**Ephemeral key minting (`mintEphemeralAuthKey`)**

Two sequential HTTP calls to the Tailscale API:

1. `POST https://api.tailscale.com/api/v2/oauth/token` with `grant_type=client_credentials` + `client_id` + `client_secret` → `access_token`.
2. `POST https://api.tailscale.com/api/v2/tailnet/-/keys` with `Authorization: Bearer <access_token>` → key with `capabilities.devices.create = { reusable: false, ephemeral: true, preauthorized: true, tags: [tag] }`, `expirySeconds: 3600`, `description: "fleet <hostname>"`.

Returns the `key` string or `null` on any error (network or non-2xx). The caller falls back to the shared `app_settings.tailscale_auth_key` if minting fails. OAuth minting requires `tailscale_oauth_client_id`, `tailscale_oauth_client_secret`, and `tailscale_tag` all to be configured in `app_settings`.

**APK hosting for zero-touch install**

`POST /super-admin/settings/tailscale-apk` stores the Tailscale APK at `{UPLOADS_ROOT}/tailscale/tailscale.apk`, records `tailscale_apk_key` and `tailscale_apk_sha256` in `app_settings`. When an `up` command is built, the payload includes `tailscaleApk: { url: <signed-URL>, sha256 }` if the APK is present. Device-Owner phones can silently install it before connecting.

**Global settings (`app_settings` singleton)**

`GET /super-admin/settings/tailscale` returns an `AppSettings` object. Secrets are **never** returned — they are masked to boolean flags (`tailscaleAuthKeySet`, `tailscaleOauthConfigured`). `PUT /super-admin/settings/tailscale` accepts partial updates via `updateTailscaleSettingsSchema`; send `''` to clear a secret field, omit the field to leave it unchanged.

### `MobileLogsService` change

`MobileLogsService.ingest(entries, userId, deviceId?)` now accepts an optional `deviceId` string and writes it into every Winston meta object. `MobileLogsController` reads `body.deviceId` from the ingest DTO and passes it through. This allows the log viewer above to correlate log lines to a specific registered device.

---

## Job Scheduler (`src/jobs/job-scheduler.service.ts`)

`JobSchedulerService` implements `OnModuleInit`. On startup, calls `upsertJobScheduler()` for the repeating jobs below (idempotent across the 2 Swarm replicas -- stable scheduler IDs, safe to call on every boot):

| Queue | Schedule | Purpose |
|---|---|---|
| `geofence-check` | every 2 min (+ event-driven) | `GeofenceProcessor` -- checks ST_Contains for all active assignments; a fresh GPS report also nudges an immediate (throttled) check |
| `alert-evaluation` | every 15 min | `AlertsProcessor` -- checks odometer/GPS discrepancy + timing anomalies |
| `reconciliation` | every 60 min | `ReconciliationProcessor` -- bale count + fuel reconciliation |
| `sync-cleanup` | daily 02:00 (cron) | `SyncCleanupProcessor` -- purges idempotency records > 30 days |
| `truck-idle-check` | every 5 min | `TruckIdleProcessor` -- checks if a truck has been idle > `STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN` (default 30 min); sends loader-recall push if so (Plan C); the processor dedups against unacknowledged alerts in the last 60 min |
| `pin-regen` | daily 02:00 Europe/Bucharest (cron) | `PinRegenProcessor` -- regenerates every beneficiary's daily 4-digit portal PIN |
| `presence-deadman` | every `PRESENCE_DEADMAN_RUN_MS` (90 s -- `@strawboss/types` `presence.ts` SSOT) | `PresenceDeadmanProcessor` -- FCM-wakes any device-owner phone whose `last_checkin_at` is past `PRESENCE_DEADMAN_STALE_MS` (240 s); see [[backend#Presence cadence hierarchy]] |
| `gps-retention` | daily 02:30 (cron) | `GpsRetentionProcessor` (`src/location/gps-retention.processor.ts`) -- retention/downsampling of `machine_location_events` (D1): batched-delete rows > 90 days; batched-downsample the 14–90 day window to 1 point/machine/minute (NULL-`machine_id` rows downsampled per-operator instead); each step capped at 50 batches of 20 000 rows per run so a first-time backlog is worked off over several nights instead of blocking |
| `stale-plan-sweep` | daily 00:15 Europe/Bucharest (cron) | `StalePlanSweepProcessor` (`src/trips/stale-plan-sweep.processor.ts`) -- auto-cancels stale own-fleet `planned` trips; see [[backend#Trips]] |

The `cmr-generation` queue is on-demand only (triggered by trip completion or manual endpoint). The `comanda-generation` queue (`QUEUE_COMANDA_GENERATION`, `ComandaProcessor`) is likewise on-demand, queued from `TripRequestsService.insertBeneficiaryRequest()` (best-effort, `attempts: 2`); see [[backend#Comandă (transport order) PDF]]. `message-send` (`QUEUE_MESSAGE_SEND`) is on-demand too, queued from `TripRequestsService.confirm()` to send the transport-confirmation email/SMS via `messaging/transport-confirmation.processor.ts`. `trip-autocomplete` (`QUEUE_TRIP_AUTOCOMPLETE`) is a per-trip delayed job (auto-completes an auxiliary trip a few minutes after it is loaded).

The `ota-deploy` queue uses **delayed jobs** (not repeating). Each job is added by `FleetService.createDeployment()` when `scheduledAt` is set; `OtaDeployProcessor` processes it by calling `FleetService.activateDeployment()`. Immediate deployments bypass the queue entirely.

---

## Swarm / Multi-Replica Safety

The backend runs as **2 Swarm replicas** (`backend` service in `docker-stack.yml`). The following mechanisms keep it correct under concurrent replicas and zero-downtime rolling deploys.

### Graceful shutdown (`main.ts`)

`app.enableShutdownHooks()` is enabled. Signal handlers for `SIGTERM` and `SIGINT` call `await app.close()`, which:

1. Stops accepting new HTTP requests (Fastify closes its listener).
2. Drains in-flight HTTP requests.
3. Fires `onModuleDestroy` on every module — closes BullMQ workers so active jobs finish before the process exits.

Paired with `stop_grace_period` in `docker-stack.yml`. The outgoing replica on a rolling deploy shuts down cleanly instead of dropping requests.

### Database connection pool (`drizzle.provider.ts`)

`DATABASE_URL` points at the **Supabase session-mode pooler** (one upstream server connection held per client connection). The pool is capped per replica:

- `max: 8` connections per replica
- `idle_timeout: 20` s
- `connect_timeout: 10` s

With 2 replicas: ~16 steady connections, ~24 peak during a rolling deploy (old + new replica both live). Stays within the pooler budget.

`DrizzleProvider.client` (the raw `ReturnType<typeof postgres>`) is also exposed publicly so modules that need a session-scoped pinned connection can call `.reserve()` on it directly.

### Boot backfill advisory lock (`trips.service.ts` `onModuleInit`)

The truck-task backfill that runs on every boot is guarded by a PostgreSQL advisory lock to prevent duplicate trip materialization when both replicas cold-start simultaneously:

1. Reserves a pinned connection via `drizzleProvider.client.reserve()`.
2. Calls `pg_try_advisory_lock(hashtext('strawboss:trip-backfill'))` on that connection.
3. If the lock is not acquired (another replica holds it), returns immediately — the other replica owns the backfill this boot.
4. Releases with `pg_advisory_unlock(...)` in `finally`, then calls `.release()` on the connection.

The lock is session-scoped and self-releases if the process dies. Does not fire on normal one-at-a-time rolling deploys (the old replica finishes before the new one boots).

### Already multi-instance-safe

| Mechanism | Why it is safe |
|---|---|
| BullMQ repeatable jobs | Seeded with stable scheduler IDs via `upsertJobScheduler()` — one job per interval across all replicas |
| BullMQ processors | Competing-consumer workers — only one replica processes each job |
| Redis-backed PIN throttle | Shared Redis state — rate limit is global, not per-replica |
| `sync_idempotency` table | Postgres-level dedup — duplicate sync pushes from mobile are idempotent |
| No in-memory pub/sub | No WebSocket or socket.io state — each request is stateless |

---

## Error Handling

### `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`)
Catches all exceptions. For `HttpException`, extracts status + message. Logs 5xx as `error`, 4xx as `warn`. Returns JSON: `{ statusCode, message, error, timestamp, requestId?, ...details? }`.

**Fixed `ac1640b`**: every Zod validation failure used to reach the client as a generic "Internal server error" -- `ZodValidationPipe` threw `result.error.flatten()` (which has no `message` key), and the filter's `resp.message ?? 'Internal server error'` fell straight through to the 500-fallback text on a 400. 329 rejected requests in the logs carried this bug, 13 of them on `register-load`, and the actual `fieldErrors` were logged nowhere. The filter now: handles `resp.message` being an **array** (Nest's own built-in `ValidationPipe` emits `string[]`) by joining it; falls back to `'Cerere invalidă.'` (not the 500 text) for any status `< 500` with no message; and surfaces `fieldErrors`/`formErrors` as top-level `details` on both the Winston log line and the JSON response, whenever the thrown exception carries them.

### `LoggingInterceptor` (`src/common/interceptors/logging.interceptor.ts`)
Assigns `X-Request-Id` (from header or `randomUUID()`). Logs one line per request at Winston level `http` with: method, path, statusCode, durationMs, userId, ip.

### `ZodValidationPipe` (`src/common/pipes/zod-validation.pipe.ts`)
Wraps `schema.safeParse()`. On failure, throws `BadRequestException({ statusCode: 400, error: 'validation_failed', message, fieldErrors, formErrors })` (fixed alongside the filter above, `ac1640b`) -- `message` is a real per-field summary (`"baleCount: Expected number, received string"`, joined with whole-object refine failures from `formErrors`, e.g. "exactly one of parcelId or sourceDepotId is required"), not Zod's bare `flatten()` object. Also exposes a public `.transform(value)` method (used by `TransporterController` where the Zod schema is picked dynamically per record-kind, so the pipe can't be applied via the `@Body(new ZodValidationPipe(schema))` decorator pattern).

---

## Environment Variables

Required (validated in `src/config/env.validation.ts`):

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3001) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `SUPABASE_JWT_SECRET` | HS256 JWT signing secret |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis URL for BullMQ (default: `redis://localhost:6379`) |

Additional from `.env.example`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL for client-side (baked into Next.js build) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for client-side |
| `NEXT_PUBLIC_API_URL` | Public API URL for admin-web production build |
| `CORS_EXTRA_ORIGINS` | Comma-separated extra CORS origins |
| `LOG_ROOT` | Custom log directory (Docker: `/app/logs`) |
| `STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN` | Minutes before truck-idle BullMQ job fires a loader-recall push (default: 30, coerced int > 0) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON string of a Firebase service account credential (optional); enables FCM acceleration push for OTA deployments via `FleetPushService`; if absent, the service is a no-op and devices fall back to poll |
| `REDIS_PASSWORD` | Redis password for Docker Compose |
| `CERTBOT_EMAIL` | Let's Encrypt cert email |

---

## Related Docs

- [Admin Web](admin-web.md) -- consumes these endpoints via `@strawboss/api` hooks
- [Mobile App](mobile.md) -- uses sync/push, sync/pull, location/report, and notification endpoints
