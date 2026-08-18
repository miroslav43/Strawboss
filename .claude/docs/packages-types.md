---
type: doc
title: "@strawboss/types"
created: 2026-04-16
updated: 2026-08-18
tags: [doc, package, types, typescript]
status: mature
related:
  - "[[architecture]]"
  - "[[database]]"
  - "[[packages-validation]]"
  - "[[packages-domain]]"
  - "[[backend]]"
  - "[[feature-toggles]]"
---

# @strawboss/types

Zero-dependency TypeScript interfaces and enums. Every entity's canonical shape lives here.
All IDs are UUID strings, all dates are ISO 8601 strings, and all mutable entities support soft-delete via `deletedAt`.

**Source:** `packages/types/src/`

## Common Patterns

Defined in `packages/types/src/common.ts`:

| Interface | Fields | Purpose |
|---|---|---|
| `Timestamps` | `createdAt: string`, `updatedAt: string` | Mixed into every mutable entity |
| `SoftDelete` | `deletedAt: string \| null` | Mixed into every deletable entity |
| `GeoPoint` | `lat: number`, `lon: number` | GPS coordinates (used by parcels, trips, destinations) |
| `PaginatedResponse<T>` | `data: T[]`, `total`, `page`, `pageSize`, `totalPages` | Wraps list endpoints |

## Feature Registry (`features.ts`)

`packages/types/src/features.ts` is the SSOT for the per-organization feature-toggle system — full
mechanics (resolution algorithm, backend enforcement, admin/mobile consumption, invariants) are in
[[feature-toggles]]; this is the type-level shape only.

- **`FEATURE_MODULES`** (10): `bales`, `geo`, `depot`, `costs`, `documents`, `aux`, `portals`,
  `messaging`, `analytics`, `roles`. **`FEATURE_KEYS`** adds 47 leaf keys (`'<module>.<leaf>'`); the
  array is the source of the `FeatureKey` union, so a typo in `@RequireFeature(...)` is a compile error.
- **`FeatureDef`**: `module`, `defaultEnabled: true` (literal type — `false` cannot compile),
  `dependsOn: readonly FeatureKey[]`, `surfaces: readonly ('web'|'mobile'|'api'|'jobs')[]`,
  `gatesJobs?: readonly string[]`, `uiSwitch: boolean`, `uiOnly?: boolean`, `wired: boolean`.
- **`FEATURES: Readonly<Record<FeatureKey, FeatureDef>>`** — `Record`, not `Partial<Record>`, so a key
  added to `FEATURE_KEYS` without a matching definition is a compile error, not a runtime crash on the
  first org that touches it.
- **`FeatureOverrides = Partial<Record<FeatureKey, boolean>>`** — sparse, stored in
  `organizations.feature_overrides` (migration `00093`).
- **`resolveDisabledFeatures(overrides?): FeatureKey[]`** — bounded fixed-point closure; returns only
  the disabled keys.
- **`isFeatureEnabled(disabled: readonly string[], key: string): boolean`** — takes plain strings
  deliberately (fail-open for keys an older/newer build doesn't recognise).
- **`FEATURE_PRESETS`** (`new_org`/`basic`/`pro`/`enterprise`) + **`applicablePreset(preset)`** — presets
  written against the full registry, expanded to currently-wired keys.
- **`featureLabelKey(key)`** — derives the i18n key (`features.module.<key>` / `features.item.<key>`)
  from the `FeatureKey` itself so a label can never drift from the registry.

`Organization` (`entities/organization.ts`) carries none of this directly — `feature_overrides` and
`plan_label` are deliberately NOT on the `Organization` interface (the service's `ORG_COLS` projection
doesn't select them, so declaring them there would make every `list()`/`findById()` a type lie).
Instead: **`OrgFeatureSettings`** (`featureOverrides`, `planLabel`, `activeUsersByRole`) is the
super-admin console's read shape, and **`UpdateOrgFeaturesDto`** (`featureOverrides`, `planLabel?`,
mandatory `reason`) is its write payload — see [[feature-toggles]].

## Locale (`locale.ts`) — added Aug 2026

SSOT for interface languages, modelled on `features.ts`/`presence.ts`. Replaced a set duplicated in
17 places (TS unions, zod enums, backend DTOs, picker arrays) — a forgotten 18th either failed loud
(zod 400, TS compile error) or failed silent (a picker array just never showed the new language).

- **`SUPPORTED_LOCALES = ['ro', 'en', 'hu'] as const`** — order is picker order. **`Locale`** is
  `(typeof SUPPORTED_LOCALES)[number]`.
- **`DEFAULT_LOCALE: Locale = 'ro'`** — not `'en'`. Romanian is the live operational language (38/44
  production accounts) and what mobile has always assumed; the `users.locale` DB column default of
  `'en'` is a leftover no account actually reaches (`admin-users.service.ts` always writes `'ro'` on
  create).
- **`LOCALE_ENDONYMS: Record<Locale, string>`** — `{ ro: 'Română', en: 'English', hu: 'Magyar' }`, for
  pickers.
- **`LOCALE_BCP47: Record<Locale, string>`** — `{ ro: 'ro-RO', en: 'en-GB', hu: 'hu-HU' }`, the full
  tag `Intl.DateTimeFormat`/`NumberFormat`/`Collator` need (separate from `Locale` because Intl wants
  more than a bare two-letter code).
- **`isLocale(value): value is Locale`** — type guard for anything from DB/localStorage/network.
- **`normalizeLocale(raw: string | null | undefined): Locale`** — accepts full tags (`'hu-HU'`),
  case-insensitive, prefix-matched against `SUPPORTED_LOCALES`; unknown/missing → `DEFAULT_LOCALE`.
  Correct as long as no supported code is a prefix of another (true today for all two-letter ISO
  639-1 codes, not guaranteed by the `Locale` type itself if a longer code is ever added).

**No DB migration backs this.** `users.locale` is `TEXT DEFAULT 'en'` with **no CHECK constraint** —
deliberate: a CHECK would fail with `23514` → a raw 500 instead of a clean 400, and would turn every
future language into a migration. The runtime guard is the zod enum built from `SUPPORTED_LOCALES`
(`packages/validation/src/schemas/{profile,user}.schema.ts` — `z.enum(SUPPORTED_LOCALES)`), not the
database.

**Adding a 4th language:** add its code to `SUPPORTED_LOCALES` (+ endonym + BCP-47 tag) here, then
create its three sibling catalogs — `backend/service/src/common/i18n/catalogs/<code>.ts`,
`apps/admin-web/messages/<code>.json`, `apps/mobile/src/i18n/<code>.ts`. Nothing else needs editing:
each `Record<Locale, …>` map that assembles the catalogs (admin-web's `i18n.tsx`, mobile's
`i18n.tsx`, backend's `common/i18n/index.ts`) won't compile until the new catalog exists — that's the
one loud failure the whole design is built around. `apps/admin-web/scripts/check-i18n-parity.mjs`
needs no edit either — it **discovers** locales by scanning `messages/*.json` for a two-letter
filename, not from a hardcoded list.

**Verification trap:** the compiled union is not `grep`-able. `z.enum(SUPPORTED_LOCALES)` imports the
array rather than inlining its members, so `'hu'` never appears as a source literal in the emitted
schema — searching validation/backend source for `"hu"` proves nothing about whether the enum
actually accepts it. Verify by running the built `dist/` and calling `.safeParse('hu')`, not by
reading source.

## Entities

### User (`entities/user.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `UserRole`:** `super_admin`, `admin`, `dispatcher`, `baler_operator`, `loader_operator`, `driver`, `geofence_maker`, `depot_manager`, `transportator`

`transportator` (added Jul 2026): an external hauler with a **WEB-only** account — no mobile app, no machine, no depot. Submits auxiliary-transport requests through an authenticated copy of the beneficiary portal (scoped to admin-assigned beneficiaries via `TransporterBeneficiary`, see below) and watches request status read-only, filtered to `trip_requests.created_by_user_id = <self>`.

| Field | Type |
|---|---|
| `id` | `string` (UUID) |
| `email` | `string` |
| `username` | `string \| null` |
| `pin` | `string \| null` |
| `phone` | `string \| null` |
| `fullName` | `string` |
| `role` | `UserRole` |
| `isActive` | `boolean` |
| `locale` | `string` (interface language — validated against `SUPPORTED_LOCALES` on write, see [[packages-types#Locale (locale.ts)]]; the DB column itself is unconstrained `TEXT`) |
| `avatarUrl` | `string \| null` |
| `signatureSpecimenUrl` | `string \| null` |
| `lastLoginAt` | `string \| null` |
| `lastSeenAt` | `string \| null` (Plan C heartbeat, updated by `POST /profile/heartbeat`) |
| `isOnline` | `boolean \| undefined` (derived, not stored) |
| `assignedMachineId` | `string \| null` |
| `organizationId` | `string \| null \| undefined` (present on profile responses) |
| `organizationSlug` | `string \| null \| undefined` |

### Farm (`entities/farm.ts`)

Simple grouping entity with inline timestamps (no mixin).

Fields: `id`, `name`, `address`, `phone`, `fiscalCode`, `registrationNumber`, `bankAccount`, `bankName`, `createdAt`, `updatedAt`, `deletedAt`.

### Parcel (`entities/parcel.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `ParcelStatus`:** `active`, `inactive` (@deprecated T9.2)
**Enum `CropType`:** `grau`, `orz`, `rapita`, `plante_nutret` (T9.1, nullable on storage)
**Enum `HarvestStatus`:** `planned`, `to_harvest`, `harvesting`, `partial_harvested`, `harvested`, `in_loading`, `loaded`, `completed` (T9.10 extended ladder)
**Const `HARVEST_STATUS_RANK`:** `Record<HarvestStatus, number>` — mirrors `harvest_status_rank()` SQL function (0–7).

Fields: `id`, `code`, `name` (@deprecated T9.3), `areaHectares`, `boundary` (GeoJSON string), `centroid` (GeoPoint), `address`, `municipality`, `farmtrackGeofenceId`, `farmId`, `notes`, `isActive` (@deprecated T9.2), `harvestStatus`, `cropType: CropType | null`.

### Machine (`entities/machine.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `MachineType`:** `truck`, `loader`, `baler`
**Enum `FuelType`:** `diesel`, `gasoline`, `electric`

Fields: `id`, `machineType`, `registrationPlate`, `internalCode`, `make`, `model`, `year`, `fuelType`, `tankCapacityLiters`, `farmtrackDeviceId`, `currentOdometerKm`, `currentHourmeterHrs`, `isActive`, `maxPayloadKg`, `maxBaleCount`, `tareWeightKg`, `balesPerHourAvg`, `baleWeightAvgKg`, `reachMeters`, `companyName`, `companyAddress`, `ownerCompanyName`, `ownerCompanyAddress`, `ownerCompanyCui`, `isAuxiliary: boolean` (one-time truck spun up from a confirmed `trip_request`; no linked driver user; auto-deactivated once its trip completes).

Read-only enrichment (`machines` `list()` only, optional): `primaryContactName?` (the aux truck's originating request's `requester_name`), `assignedOperatorName?` (full name of the user permanently assigned via `users.assigned_machine_id`), `assignedOperatorAvatarUrl?` (that user's `avatar_url`; `null` when no photo was uploaded — the UI must not render a default/initials tile in that case).

### Trip (`entities/trip.ts`)

Extends `Timestamps`, `SoftDelete`. The core domain entity.

**Enum `TripStatus`:** `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`, `cancelled`, `disputed`

**Enum `AuxStage`** (added Jul 2026, `entities/trip.ts`): the single, honest status of an auxiliary transport — collapses the two axes that neither alone describes it (`trip_requests.status`, frozen after confirm, and `trips.status`, which may not exist yet). Values, in display order (`AUX_STAGE_ORDER`): `pending`, `unplanned` (confirmed + aux truck minted, not yet scheduled by a dispatcher — previously invisible), `planned`, `loading`, `awaitingSignature` (loaded; external driver hasn't signed the CMR via the public link), `signed`, `completed`, `cancelled`. `ACTIVE_AUX_STAGES` is the same list minus `completed`/`cancelled` — the aux table's default view. Composed by `composeAuxStage()` / sorted by `auxStageOrder()` in `@strawboss/domain` (see [[packages-domain]]); never emits `in_transit`/`arrived`/`delivering`/`delivered` since an aux trip cannot reach them. `AUXILIARY_TRIP_STATUSES` (pre-existing) is the raw 3-value `TripStatus` subset (`planned`, `loaded`, `completed`) an aux trip's own `status` column can hold — `AuxStage` is the richer, request-aware ladder built on top of it.

Key fields: `tripNumber`, `status`, `sourceParcelId`, `sourceDepotId` (depot source — exactly one of `sourceParcelId`/`sourceDepotId` set), `sourceParcelAuto`, `loaderId`, `truckId`, `loaderOperatorId`, `driverId` (null for an auxiliary trip), `baleCount`, `deliveredBaleCount` (bales actually delivered, `baleCount - deterioratedBalesCount`; null for depot-confirmed trips), timestamps for each phase (`loadingStartedAt` through `completedAt`), destination info, weight data (`grossWeightKg`, `tareWeightKg`, `netWeightKg`), `scaleBroken: boolean` (count-only confirmation, no scale), receiver info (`receiverName`, `receiverSignatureUrl`), `loaderSignatureUrl` (set at complete-loading), `driverSignatureUrl` (no longer set at depart — see DTOs below), `deterioratedBalesCount` (set at confirm-delivery), `fraudFlags`, `clientId`, `syncVersion`, `parentTripId: string | null` (Plan C multi-iteration), `iterationIndex: number` (1-based, default 1), `isAuxiliary: boolean`, `externalDriverName/Phone/Email`, `publicSignTokenUsedAt` (the bearer token itself, `publicSignToken`, is **deliberately absent** from this type — fixed Jul 2026 after `GET /trips` leaked it to every authenticated client via `SELECT t.*`; only the "used" timestamp is safe to expose), `tripRequestId`, `destinationHasOperator?` (read-model flag, depot has a `depot_manager`), and depot-operator confirmation fields `depotOperatorId`, `depotConfirmedAt`, `depotOperatorSignatureUrl`. Enriched join labels (optional, `GET /trips/:id` only) include `sourceDepotName?` (name of the depot the trip was loaded from, alongside the pre-existing `sourceParcelName`/`sourceFarmName`/`sourceParcelMunicipality`).

### TaskAssignment (`entities/task-assignment.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `AssignmentPriority`:** `low`, `normal`, `high`, `urgent`
**Enum `AssignmentStatus`:** `available`, `in_progress`, `done`

Fields: `id`, `assignmentDate`, `machineId`, `parcelId`, `assignedUserId`, `priority`, `sequenceOrder`, `status`, `parentAssignmentId`, `destinationId`, `estimatedStart`, `estimatedEnd`, `actualStart`, `actualEnd`, `notes`.

### BaleLoad (`entities/bale-load.ts`)

Extends `Timestamps`, `SoftDelete`. Links a bale pickup event to a trip.

Fields: `id`, `tripId`, `parcelId`, `loaderId`, `operatorId`, `baleCount`, `loadedAt`, `gpsLat`, `gpsLon`, `farmtrackEventId`, `notes`, `clientId`, `syncVersion`.

### BaleProduction (`entities/bale-production.ts`)

Extends `Timestamps`, `SoftDelete`. Records baling output per parcel.

Fields: `id`, `parcelId`, `balerId`, `operatorId`, `productionDate`, `baleCount`, `avgBaleWeightKg`, `startTime`, `endTime`, `farmtrackSessionId`.

### FuelLog (`entities/fuel-log.ts`)

Extends `Timestamps`, `SoftDelete`.

Fields: `id`, `machineId`, `operatorId`, `parcelId`, `loggedAt`, `fuelType` (reuses `FuelType`), `quantityLiters`, `unitPrice`, `totalCost`, `odometerKm`, `hourmeterHrs`, `isFullTank`, `receiptPhotoUrl`, `notes`, `clientId`, `syncVersion`.

### ConsumableLog (`entities/consumable-log.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `ConsumableType`:** `twine`, `net_wrap`, `silage_film`, `other`

Fields: `id`, `machineId`, `operatorId`, `parcelId`, `consumableType`, `description`, `quantity`, `unit`, `unitPrice`, `totalCost`, `loggedAt`.

### DeliveryDestination (`entities/delivery-destination.ts`)

Extends `Timestamps`, `SoftDelete`.

Fields: `id`, `code`, `name`, `address`, `coords` (GeoPoint), `contactName`, `contactPhone`, `contactEmail`, `boundary` (GeoJSON string), `isActive`.

### Document (`entities/document.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `DocumentType`:** `cmr`, `cmr_scan`, `invoice`, `delivery_note`, `weight_ticket`, `report`, `comanda` — `cmr` is the CMR the backend generates itself (Puppeteer); `cmr_scan` is the physical paper CMR the loader photographs at the end of an auxiliary load, a separate artefact with its own slot rather than competing with the generated one; `comanda` (added Jul 2026) is the transport-order PDF generated (Puppeteer) when a transporter submits a request, built from the per-beneficiary `BeneficiaryOrderSettings` + request data — request-scoped like an aviz.
**Enum `DocumentStatus`:** `pending`, `generating`, `partial`, `generated`, `sent`, `failed`

Fields: `id`, `tripId` (nullable), `tripRequestId` (nullable — a document is scoped to a trip, e.g. a generated CMR/weight-ticket, OR to a trip request, e.g. an aviz/comandă), `documentType`, `status`, `title`, `fileUrl`, `fileSizeBytes`, `mimeType`, `metadata` (JSONB), `generatedAt`, `sentAt`, `sentTo` (string array).

### TripRequest (`entities/trip-request.ts`)

Extends `Timestamps`, `SoftDelete`. An external pickup request submitted through the per-org public portal (`/<slug>/request`); on confirmation it spins up a one-time auxiliary truck (`machineId`) and, once assigned, an auxiliary trip (`tripId`). See [[packages-api]] for the `use-trip-requests.ts` hooks.

**Enum `RequestStatus`:** `pending`, `confirmed`, `cancelled`

Key fields: `organizationId`, `status`; requester (`requesterName/Phone/Email`, `companyName/Address/Cui`); their truck (`truckRegistrationPlate`, `truckMake/Model/CapacityTons`); their driver, no app account (`driverName/Phone/Email`); the ask (`cropType`, `quality`, `neededDate`, `tonsRequested`, `destinationAddress/Locality/Coords`); comandă fields (added Jul 2026): `unloadingDate` (delivery date typed on the transporter form; `neededDate` is the loading date; NULL for the public portals) and `comandaOrderNo` (per-beneficiary order counter, set once at first generation so regeneration is idempotent); beneficiary-portal transporter fields (`beneficiaryId`, `trailerRegistrationPlate`, `transporterCui/Name/Address`); `notifyRecipients: NotifyRecipient[]` — denormalized snapshot of the selected contacts, fanned out (email + SMS) on confirm; **pickup source, exactly one of** `sourceDepotId` / `sourceParcelId` (field-sourced pickup added Jul 2026 — the dispatcher can now confirm a request against a field instead of a depot); `createdByUserId` (added Jul 2026 — the logged-in `transportator` who submitted this request through the authenticated form; NULL for the public/beneficiary portals; backs the transporter's own read-only ledger via `created_by_user_id = <self>`) and its resolved `createdByName?`; linkage filled on confirm (`machineId`, `tripId`, `confirmedBy`, `confirmedAt`, `cancelledAt`, `cancellationReason`); read-only join enrichment (`machineMake/Model/Plate`, `sourceDepotName`, `sourceParcelName`, `confirmedByName`); `hasAviz?: boolean` (non-deleted `delivery_note` document exists); `hasCmrScan?: boolean` (non-deleted `cmr_scan` document exists — uploaded by the loader after an aux load, or overridden by an admin); `hasComanda?: boolean` (added Jul 2026 — a generated `comanda` document exists).

**Live-trip read model** (added Jul 2026): populated ONLY by `list()`/`findById()`, from a `LEFT JOIN LATERAL` on `trips.trip_request_id` (the stable direction — `tripId` above is a last-write-wins pointer never cleared when a trip is soft-deleted). All fields are absent until a dispatcher materializes the trip on the truck board. `tripLiveId?`, `tripNumber?`, `tripStatus?: TripStatus`, `tripBaleCount?`, `tripLoadingCompletedAt?`, `tripCompletedAt?`, `tripSignedAt?` (when the external driver signed via the public link), `tripSourceParcelName?`, `tripSourceDepotName?`, `tripCount?` (number of live trips on this request — >1 is an anomaly worth surfacing). This read model is exactly what `composeAuxStage()` in `@strawboss/domain` consumes to compute `AuxStage` (see the Trip entity above and [[packages-domain]]).

`NotifyRecipient`: `{ name: string; phone: string | null; email: string | null }`.

Related DTOs (same file): `CreateTripRequestDto` (public submission payload, no auth), `PortalInfo` (org name + allowed crop types, returned after portal code verification), `PublicSignInfo` (load summary shown to the driver on the public sign page).

### TransporterBeneficiary (`entities/transporter.ts`) — added Jul 2026

The many-to-many link between a transporter user (`UserRole.transportator`) and the beneficiaries an admin has allowed them to act for. A transporter may only submit requests — and only sees saved contacts/trucks/drivers — for beneficiaries they are assigned to; the backend enforces this on every write via `assertAssigned(orgId, userId, beneficiaryId)`, the authenticated analogue of the public portal's daily-PIN check. Membership is set-replace (hard delete — no soft-delete, since nothing FKs to this table; a submitted `trip_requests` row keeps its beneficiary snapshot regardless of later membership changes).

Fields: `id`, `organizationId`, `transporterUserId`, `beneficiaryId`, `createdAt`.

### BeneficiaryOrderSettings (`entities/beneficiary-order-settings.ts`) — added Jul 2026

Per-beneficiary "comandă" (transport order) settings — the fields of the order that are constant for a beneficiary and don't exist on a trip. A transporter fills these once per assigned beneficiary (Beneficiari tab); the comandă generator merges them with the request data. Singleton per beneficiary (no `Timestamps`/`SoftDelete` mixin — inline `createdAt`/`updatedAt` only).

Fields: `id`, `organizationId`, `beneficiaryId`, `transportValue: number | null` ("Valoare transport" amount, e.g. 680), `currency` (e.g. "EUR"), `paymentTermDays` ("OP la {N} de zile de la primirea actelor în original"), `baleCount: number | null` (standard bale count for this beneficiary), `baleDimensions: string | null` (e.g. "240X120X90"), `goodsName: string | null` (e.g. "PAIE"), `truckDescription: string | null` (e.g. "CAMION CU REMORCA MEGA/VARIO"), `loadingLocality`/`loadingCountry`, `obs: string | null` (e.g. "Actele în original se vor trimite la adresa: NU"), `orderCounter` (per-beneficiary running order counter — the next comandă is `orderCounter + 1`), `createdAt`, `updatedAt`.

### Alert (`entities/alert.ts`)

Extends `Timestamps` only (no SoftDelete).

**Enum `AlertCategory`:** `fraud`, `anomaly`, `maintenance`, `safety`, `system`
**Enum `AlertSeverity`:** `low`, `medium`, `high`, `critical`

Fields: `id`, `category`, `severity`, `title`, `description`, `relatedTable`, `relatedRecordId`, `tripId`, `machineId`, `data` (JSONB), `isAcknowledged`, `acknowledgedBy`, `acknowledgedAt`, `resolutionNotes`.

### AuditLog (`entities/audit-log.ts`)

Standalone (no mixins). Append-only.

**Enum `AuditOperation`:** `insert`, `update`, `delete`

Fields: `id`, `tableName`, `recordId`, `operation`, `oldValues`, `newValues`, `changedFields` (string array), `userId`, `clientId`, `ipAddress`, `createdAt`.

### Other Entities

- **ParcelDailyStatus** (`entities/parcel-daily-status.ts`): `id`, `parcelId`, `statusDate`, `isDone`, `notes`, timestamps.
- **MachineLocationEvent** (`entities/machine-location-event.ts`): `id`, `machineId`, `operatorId`, `lat`, `lon`, `coords`, `accuracyM`, `headingDeg`, `speedMs`, `recordedAt`, `createdAt`.
- **MachineLastLocation** (same file): aggregated view with `machineCode`, `machineType`, `operatorName`, `assignedUserId`, `assignedUserName`, `locality?: string | null` (added Jul 2026 — reverse-geocoded nearest locality for `(lat, lon)`, best-effort and cached server-side; `null` when not yet cached or the position is stale).
- **DevicePushToken** (`entities/device-push-token.ts`): `id`, `userId`, `machineId`, `token`, `platform`, `isActive`, timestamps.
- **GeofenceEvent** (`entities/geofence-event.ts`): `id`, `machineId`, `assignmentId`, `geofenceType` (`'parcel' | 'deposit'`), `geofenceId`, `eventType` (`'enter' | 'exit'`), `lat`, `lon`, `createdAt`.

### Device / Fleet (`entities/device.ts`)

Added in the Fleet Management + OTA feature. Exported from `packages/types/src/index.ts` via `export * from './entities/device.js'`.

#### Enums

| Enum | Values |
|---|---|
| `OtaState` | `pending`, `notified`, `downloading`, `downloaded`, `awaiting_idle`, `installing`, `installed`, `failed` |
| `OtaDeploymentStatus` | `pending`, `active`, `completed`, `cancelled` |
| `ReleaseStatus` | `draft`, `published`, `archived` |
| `OtaTargetKind` | `all`, `org`, `device_set` |

#### Interfaces

**`Device`** extends `Timestamps`, `SoftDelete`. Canonical registry row for one app install.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | |
| `deviceUuid` | `string` | SecureStore-persisted UUID — the real device identity |
| `organizationId` | `string \| null` | null until super-admin assigns |
| `name` | `string \| null` | Super-admin display label |
| `androidId` | `string \| null` | |
| `model` | `string \| null` | |
| `manufacturer` | `string \| null` | |
| `osVersion` | `string \| null` | |
| `appVersion` | `string \| null` | versionName, e.g. "1.0.2" |
| `versionCode` | `number \| null` | expo.android.versionCode — monotonic |
| `pushToken` | `string \| null` | FCM device token |
| `isDeviceOwner` | `boolean` | |
| `lastSeenAt` | `string \| null` | |
| `lastCheckinAt` | `string \| null` | |
| `lastActiveTrip` | `boolean` | true if device was mid-trip at last check-in (idle gate) |
| `tailscaleDesired` | `boolean` | Desired Tailscale state set by super-admin |
| `tailscaleOnline` | `boolean` | Whether the peer is currently online (from host-side status sync) |
| `tailscaleIp` | `string \| null` | Device's 100.x tailnet IP |
| `tailscaleHostname` | `string \| null` | Sanitized nickname used as the Tailscale hostname |
| `tailscaleLastSeen` | `string \| null` | |
| `tailscaleLastError` | `string \| null` | Best-effort error from the last tailscale command (device-reported) |

Note: `tailscaleApplied` (whether the device confirmed it applied the last command) is tracked in the `devices` DB table but is not exposed in the `Device` TS interface — it is an internal backend field used to decide when to issue a new command.

**`FleetDeviceListItem`** extends `Device`. List-row enriched with joins: `organizationName: string | null`, `latestOtaState: OtaState | null`, `latestDeploymentId: string | null`.

**`AppRelease`** extends `Timestamps`, `SoftDelete`. `id`, `version`, `versionCode`, `apkKey` (storage path under `UPLOADS_ROOT`), `sha256` (hex digest verified on-device), `sizeBytes`, `changelog: string | null`, `mandatory: boolean`, `status: ReleaseStatus`, `uploadedBy: string | null`.

**`OtaDeployment`** extends `Timestamps` (no SoftDelete). `id`, `releaseId`, `targetKind: OtaTargetKind`, `targetOrgId: string | null`, `targetDeviceIds: string[] | null`, `scheduledAt: string | null` (null = immediate), `forceNow: boolean`, `status: OtaDeploymentStatus`, `createdBy: string | null`.

**`DeviceOtaStatus`** (standalone, no mixins). `id`, `deploymentId`, `deviceId`, `state: OtaState`, `error: string | null`, `attempt: number`, `notifiedAt`, `downloadedAt`, `installedAt`, `updatedAt`.

**`AppSettings`**: Singleton global config returned by `GET /api/v1/super-admin/settings/tailscale`. Raw secrets are never returned — the API surfaces only masked booleans and non-secret strings.

| Field | Type | Notes |
|---|---|---|
| `tailscaleAuthKeySet` | `boolean` | Whether a shared auth key is configured |
| `tailscaleTailnet` | `string \| null` | The tailnet name (non-secret) |
| `tailscaleOauthConfigured` | `boolean` | Whether an OAuth client is configured (enables per-device ephemeral keys) |
| `tailscaleTag` | `string \| null` | Tag applied to OAuth-minted keys, e.g. `tag:fleet-phone` (non-secret) |
| `tailscaleApkSet` | `boolean` | Whether a Tailscale APK is hosted for zero-touch auto-install |
| `updatedAt` | `string \| null` | |

#### Check-in Protocol Interfaces

**`DeviceOtaReport`**: A device-driven OTA state transition reported on check-in. `deploymentId`, `state: OtaState`, `error?: string`.

**`DeviceCommand`**: A one-shot remote command the backend hands a device on check-in (currently Tailscale up/down for remote ADB access). The device applies it via Device-Owner MDM controls and reports the result in `commandReports[]` on the next check-in.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Idempotency id; the device echoes it back in its report |
| `type` | `'tailscale'` | |
| `action` | `'up' \| 'down'` | |
| `payload?` | `{ authKey, hostname, tailnet, tailscaleApk? }` | Present for `action = 'up'`. `tailscaleApk?: { url, sha256 }` — if set and Tailscale is not installed, the device silently installs this APK before configuring Tailscale |

**`DeviceCommandReport`**: Result of applying a `DeviceCommand`, reported on the next check-in. `commandId: string`, `status: 'success' | 'failure'`, `error?: string`.

**`DeviceCheckinRequest`**: Device → backend (PUBLIC endpoint). `deviceUuid`, `deviceToken?` (omitted on first registration), `appVersion`, `versionCode`, `model?`, `manufacturer?`, `osVersion?`, `androidId?`, `pushToken?`, `isDeviceOwner: boolean`, `activeTrip: boolean`, `otaReports?: DeviceOtaReport[]`, `commandReports?: DeviceCommandReport[]`, `lastError?`.

**`PendingDeployment`**: The signed APK + install policy returned when an update is pending. `deploymentId`, `releaseId`, `version`, `versionCode`, `apkUrl` (signed time-limited download URL), `sha256`, `sizeBytes`, `installPolicy: { forceNow: boolean; mandatory: boolean }`.

**`DeviceCheckinResponse`**: Backend → device. `deviceId`, `assignedOrgId: string | null`, `deviceTokenIssued?: string` (present ONLY on the first registration response — the raw HMAC token to persist), `pendingDeployment: PendingDeployment | null`, `pendingCommand: DeviceCommand | null` (a Tailscale up/down command to apply, or null).

See [[database]] for the backing SQL enums and [[packages-validation]] for the corresponding Zod schemas.

## DTOs

- **TripCreateDto** (`dtos/trip-create.dto.ts`): `sourceParcelId`, `truckId`, `driverId`, optional `loaderId`, `loaderOperatorId`, `destinationId` (added Jul 2026 — FK to the destination depot; without it the trip is invisible to the depot manager's sync pull and cannot be depot-confirmed, `destinationName`/`destinationAddress` are only a display snapshot), `destinationName`, `destinationAddress`, `destinationCoords`.
- **Trip transition DTOs** (`dtos/trip-transition.dto.ts`): `StartLoadingDto`, `ForceStatusDto` (admin-only manual status override — see below), `CompleteLoadingDto`, `DepartDto` (**empty as of Jul 2026** — the driver signature requirement was removed from `/depart`), `ArriveDto` (empty — distance is derived from the GPS track), `StartDeliveryDto`, `ConfirmDeliveryDto` (`grossWeightKg`/`tareWeightKg` now `number | null | undefined`, plus `scaleBroken?: boolean` for a delivery with no working scale — Jul 2026), `CompleteDto` (**receiver signature removed as of Jul 2026** — now just `receiverName`), `ConfirmDepotDeliveryDto` (added Jul 2026 — the depot-operator delivery confirmation: `baleCount` required, optional `grossWeightKg`/`tareWeightKg`/`scaleBroken`, `depotOperatorSignature`, `idempotencyKey`; a `depot_manager` assigned to the trip's destination confirms the arriving bale count and signs, driving the trip `arrived→delivered→completed` server-side in one action — the signature is stored as both the depot-operator and receiver signature), `DepotIncomingTruck` (one inbound truck as shown to the depot operator: `distanceM`, `isInsideGeofence`, `awaitingConfirmation`), `CancelDto`, `DisputeDto`, `ResolveDisputeDto`, `RegisterLoadDto` (atomic loader "register load" payload; `parcelId`/`sourceDepotId` are now both optional but exactly one is required — XOR, matching `registerLoadSchema`), `RegisterLoadResult`.
  - **`ForceStatusDto`** (added Jul 2026): `status`, optional `reason`, optional `expectedStatus` (optimistic-lock guard). Forcing a trip to `loaded` or beyond used to move only the status, leaving a phantom trip with 0 bales and no stock movement (4 existed in production). Now, when the target status implies goods were picked up and the trip carries no load yet, `baleCount` + exactly one of `parcelId`/`sourceDepotId` become **required** (server rejects with `load_required`); inserting the `bale_loads` row IS the stock deduction. Also carries an optional `idempotencyKey` (client-side `bale_load` UUID) so a retried override doesn't double-count.
- **SyncPushRequest / SyncPullRequest / SyncResponse** (`dtos/sync-payload.dto.ts`): See [sync-protocol.md](sync-protocol.md).
- **Dashboard DTOs** (`dtos/dashboard.dto.ts`): `DashboardOverview`, `ProductionReport`, `CostReport`, `AntiFraudReport`.
- **LocationReportDto** (`dtos/location-report.dto.ts`): `machineId`, `lat`, `lon`, optional `accuracyM`, `headingDeg`, `speedMs`, `recordedAt`, optional `source?: 'task' | 'checkin'` (added Aug 2026, migration `00097`) — `task` = the location foreground service (a real tracking fix); `checkin` = the 60 s presence alarm's best-effort fix (last-known + Balanced accuracy, network quality, presence/geofence only — never drawn as a track). Absent on APKs older than vc56; the server stores that as `NULL` and treats it as `task`. See [[backend]] "GPS Noise Filtering" and [[mobile]] "Location Tracking".
- **RouteHistoryResponse** (`dtos/route-history.dto.ts`): `machineId`, `machineCode`, `machineType`, `from`, `to`, `totalPoints`, `points: RoutePoint[]`, optional `segments?: RouteSegment[]` (absent on legacy responses — treat as one segment over all points), optional `filter?: RouteFilterStats`.
- **RouteFilterStats** (`dtos/route-history.dto.ts`): what the server removed before returning the track, so the UI can render "N points (M filtered)". `rawPoints`, `keptPoints`, `droppedLowAccuracy` (distance-total accuracy gate only, never applied to the track itself), `droppedOutlier` (impossible speed/leg), `droppedBadTimestamp`, `droppedSpike` (lone GPS excursions), optional `droppedPresence?: number` (added Aug 2026 — check-in-source rows plus network fixes inconsistent with the trusted-GPS skeleton; absent on responses from servers older than this field), `accuracyCapM` (`null` when no accuracy gate ran), `truncated`.
- **KmByDayResponse** (`dtos/route-history.dto.ts`): `machineId`, `from`, `to`, `days: { date: string; km: number; pointCount: number }[]`.
