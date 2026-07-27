---
type: doc
title: "@strawboss/validation"
created: 2026-04-16
updated: 2026-07-27
tags: [doc, package, validation, zod]
status: mature
related:
  - "[[architecture]]"
  - "[[packages-types]]"
  - "[[backend]]"
  - "[[admin-web]]"
---

# @strawboss/validation

Zod schemas mirroring every type from [@strawboss/types](packages-types.md). Provides `create*Schema` / `update*Schema` variants for backend request validation and frontend form validation.

**Source:** `packages/validation/src/`

## Helper Schemas

Defined in `packages/validation/src/helpers/`:

| Schema | File | Rule |
|---|---|---|
| `uuidSchema` | `uuid.ts` | `z.string().uuid()` |
| `isoDateSchema` | `iso-date.ts` | Regex: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS(.sss)(Z\|+HH:MM)` |
| `geoPointSchema` | `geo.ts` | `{ lat: number min -90 max 90, lon: number min -180 max 180 }` |
| `timestampsSchema` | `common.ts` | `{ createdAt: isoDate, updatedAt: isoDate }` |
| `softDeleteSchema` | `common.ts` | `{ deletedAt: isoDate.nullable() }` |

## Entity Schemas

### Farm (`schemas/farm.schema.ts`)

- `createFarmSchema`: `name` (string, min 1, required), `address` (string, optional), `phone` (optional), `fiscalCode` (optional), `registrationNumber` (optional), `bankAccount` (optional), `bankName` (optional).
- `updateFarmSchema`: All fields from create, partial.

### User (`schemas/user.schema.ts`)

- `userRoleSchema`: `z.nativeEnum(UserRole)`.
- `adminAssignableRoleSchema` (internal): roles an org admin may assign — `admin`, `dispatcher`, `loader_operator`, `driver`, `baler_operator`, `geofence_maker`, `depot_manager`, `transportator` (added Jul 2026; `super_admin` stays excluded).
- `userSchema`: Full entity with UUID id, `email` (z.string().email()), `fullName` (min 1), all fields merged with timestamps/softDelete.
- `createUserSchema`: `email` (email), `fullName` (min 1), `role`, optional `phone`.
- `updateUserSchema`: `email`, `fullName`, `role`, `phone`, `isActive`, `locale`, `avatarUrl` -- all partial.
- `setTransporterBeneficiariesSchema` / `SetTransporterBeneficiariesInput` (added Jul 2026): `{ beneficiaryIds: uuid[] max 500 }` — body for `PUT /admin/users/:id/beneficiaries`, the set of beneficiaries an admin allows a `transportator` account to act for (set-replace; empty array revokes all).

### Profile (`schemas/profile.schema.ts`)

- `updateProfileLocaleSchema`: `locale` restricted to `z.enum(["en", "ro"])`.
- `updateProfileSchema`: optional `fullName` (min 1), `phone`, `locale` (en/ro), `notificationPrefs` (Record<string, boolean>).
- `changePasswordSchema`: `currentPassword` (min 1), `newPassword` (min 8).

### Parcel (`schemas/parcel.schema.ts`)

- `harvestStatusSchema`: `z.nativeEnum(HarvestStatus)` — all 8 values (`planned` … `completed`).
- `cropTypeSchema`: `z.nativeEnum(CropType)` — `grau`, `orz`, `rapita`, `plante_nutret`.
- `parcelSchema`: Full entity. `areaHectares` must be positive. `centroid` validated as geoPoint.
- `createParcelSchema`: All fields optional (code and name auto-generated). `areaHectares` positive. Optional `cropType`.
- `updateParcelSchema`: All fields partial.

### Machine (`schemas/machine.schema.ts`)

- `machineTypeSchema`, `fuelTypeSchema`: Native enums.
- `machineSchema`: `year` range 1900-2100, `tankCapacityLiters` nonnegative, `maxPayloadKg`/`maxBaleCount`/`balesPerHourAvg`/`baleWeightAvgKg`/`reachMeters` positive (nullable).
- `createMachineSchema`: `internalCode` required (min 1), `registrationPlate` optional. `currentOdometerKm`/`currentHourmeterHrs` default nonnegative.
- `updateMachineSchema`: All fields partial.

### Trip (`schemas/trip.schema.ts`)

- `tripStatusSchema`: `z.nativeEnum(TripStatus)`.
- `tripSchema`: Full entity. `baleCount` nonneg int, odometer fields nonneg, `grossWeightKg`/`tareWeightKg` nonneg (nullable), `fraudFlags` as `z.record(z.unknown())`, `syncVersion` nonneg int.

### BaleLoad (`schemas/bale-load.schema.ts`)

- `baleLoadSchema`: `baleCount` positive int, `gpsLat` -90..90, `gpsLon` -180..180.
- `createBaleLoadSchema`: `tripId`, `parcelId`, `loaderId`, `operatorId` required (UUID). `baleCount` positive int. Optional `gpsLat`, `gpsLon`, `notes`.

### BaleProduction (`schemas/bale-production.schema.ts`)

- `baleProductionSchema`: `baleCount` positive int, `avgBaleWeightKg` positive nullable.
- `createBaleProductionSchema`: `parcelId`, `balerId`, `operatorId` required. `productionDate` (min 1). `baleCount` positive int.

### FuelLog (`schemas/fuel-log.schema.ts`)

- `fuelLogSchema`: `quantityLiters` positive, `unitPrice`/`totalCost` nonneg nullable.
- `createFuelLogSchema`: `machineId`, `operatorId` required. `quantityLiters` positive, `isFullTank` boolean required.

### ConsumableLog (`schemas/consumable-log.schema.ts`)

- `consumableTypeSchema`: `z.nativeEnum(ConsumableType)`.
- `createConsumableLogSchema`: `quantity` positive, `unit` min 1.

### DeliveryDestination (`schemas/delivery-destination.schema.ts`)

- `createDeliveryDestinationSchema`: `code`, `name`, `address` all min 1. Optional `coords`, `contactEmail` (z.string().email().nullable()).
- `updateDeliveryDestinationSchema`: All fields partial.

### Document (`schemas/document.schema.ts`)

- `documentTypeSchema`, `documentStatusSchema`: Native enums.
- `documentSchema`: `fileSizeBytes` nonneg int nullable, `sentTo` as `z.array(z.string())`.

### Alert (`schemas/alert.schema.ts`)

- `alertCategorySchema`, `alertSeveritySchema`: Native enums.
- `alertSchema`: `title` and `description` min 1.

### AuditLog (`schemas/audit-log.schema.ts`)

- `auditOperationSchema`: Native enum.
- `auditLogSchema`: `tableName` min 1, `changedFields` as string array nullable.

### TaskAssignment (`schemas/task-assignment.schema.ts`)

- `assignmentPrioritySchema`, `assignmentStatusSchema`: Native enums.
- `createTaskAssignmentSchema`: `machineId` (UUID required), `sequenceOrder` (nonneg int), defaults: `priority` = `normal`, `status` = `available`.
- `updateAssignmentStatusSchema`: `{ status: assignmentStatusSchema }`.

### ParcelDailyStatus (`schemas/parcel-daily-status.schema.ts`)

- `upsertParcelDailyStatusSchema`: `parcelId` (UUID), `statusDate` (min 1), `isDone` (boolean), optional `notes`.

### MobileLogIngest (`schemas/mobile-log-ingest.schema.ts`)

- `mobileLogEntrySchema`: `level` enum `['error','warn','info','flow','debug']`, `message` min 1 max 8000, optional `context` max 200, `meta`, `recordedAt`.
- `mobileLogIngestSchema`: optional `deviceId` (string min 8 max 128 — SecureStore UUID for pre-login attribution, added in fleet feature); `entries` array min 1 max 200.

### Fleet (`schemas/fleet.schema.ts`)

Enum validators:

- `otaStateSchema`: `z.nativeEnum(OtaState)` — 8 values.
- `releaseStatusSchema`: `z.nativeEnum(ReleaseStatus)` — `draft`, `published`, `archived`.
- `otaTargetKindSchema`: `z.nativeEnum(OtaTargetKind)` — `all`, `org`, `device_set`.

**Check-in (PUBLIC endpoint)**

- `deviceOtaReportSchema`: `deploymentId` (UUID), `state` (otaState), optional `error` (max 4000).
- `deviceCommandReportSchema`: `commandId` (UUID), `status` (enum `['success', 'failure']`), optional `error` (max 4000). Validates the result of a remote `DeviceCommand` (e.g. Tailscale up/down) reported on the next check-in.
- `deviceCheckinSchema` / `DeviceCheckinInput`: `deviceUuid` (min 8 max 128), optional `deviceToken` (max 256), `appVersion` (min 1 max 64), `versionCode` (int nonneg), optional `model`/`manufacturer`/`osVersion`/`androidId` (max 128/128/64/128), optional `pushToken` (max 512), `isDeviceOwner` (boolean), `activeTrip` (boolean), optional `otaReports` (array max 50), optional `commandReports` (array of `deviceCommandReportSchema`, max 50), optional `lastError` (max 4000).

**Super-admin: releases**

- `createReleaseSchema` / `CreateReleaseInput`: `version` (min 1 max 64), `versionCode` (coerced int positive), optional `changelog` (max 8000, nullable), optional `mandatory` (coerced boolean).
- `updateReleaseSchema` / `UpdateReleaseInput`: optional `status` (releaseStatus), optional `mandatory` (boolean), optional `changelog` (max 8000, nullable).

**Super-admin: deployments**

- `createDeploymentSchema` / `CreateDeploymentInput`: `releaseId` (UUID), `targetKind` (otaTargetKind), optional `targetOrgId` (UUID, nullable), optional `targetDeviceIds` (UUID[] min 1 max 5000, nullable), optional `scheduledAt` (ISO 8601 datetime, nullable), optional `forceNow` (boolean). Cross-field refinements: `targetKind = org` requires `targetOrgId`; `targetKind = device_set` requires at least one `targetDeviceIds` entry.

**Super-admin: device assignment / rename**

- `updateDeviceSchema` / `UpdateDeviceInput`: optional `name` (min 1 max 120, nullable), optional `organizationId` (UUID, nullable).

**Super-admin: Tailscale remote access**

- `setDeviceTailscaleSchema` / `SetDeviceTailscaleInput`: `desired` (boolean). Toggles the desired Tailscale state for one device; the device applies it via MDM on the next check-in command.
- `updateTailscaleSettingsSchema` / `UpdateTailscaleSettingsInput`: All fields optional/nullable. `authKey` (max 512, null = leave unchanged, `''` = clear), `tailnet` (max 200), `oauthClientId` (max 256), `oauthClientSecret` (max 512), `tag` (max 128 — applied to OAuth-minted keys, e.g. `tag:fleet-phone`).

### Trip Request / Beneficiary Portal (`schemas/trip-request.schema.ts`)

Backs the external pickup-request flow — the public 4-digit-code portal, the beneficiary-PIN portal, and (added Jul 2026) the authenticated `transportator` form. See [[packages-types]] `TripRequest`.

- `portalCodeSchema`: 4-digit regex (`^\d{4}$`).
- `createTripRequestSchema` / `CreateTripRequestInput`: public 4-digit-code portal (no auth). All fields required except `driverEmail`, `notes`, `destinationCoords`; `truckMake`/`destinationLocality` are not in the form at all.
- `createBeneficiaryRequestSchema` / `CreateBeneficiaryRequestInput`: beneficiary-PIN portal. Replaces truck make/model with transporter company fields (`transporterName/Cui/Address`, `trailerRegistrationPlate`); `quality` enum `['quality_1','quality_2']` instead of `cropType` (kept nullable/optional for back-compat); `unloadingDate` (comandă delivery date, added Jul 2026, nullable/optional — only the transporter form sends it); `destinationAddress`/`destinationLocality` (nullable/optional); `contactIds` (1-10 UUIDs — which saved contacts to notify on confirm, first = primary); `pin` (4-digit, re-verified server-side).
- **`createTransporterRequestSchema` / `CreateTransporterRequestInput`** (added Jul 2026): `createBeneficiaryRequestSchema.omit({ pin: true }).extend({ beneficiaryId: uuidSchema })` — identical shape to the beneficiary portal minus the daily PIN (replaced by the logged-in session) plus an explicit `beneficiaryId` (the transporter picks one of their assigned beneficiaries; the portal instead carried it in the URL slug). Kept in lock-step with `createBeneficiaryRequestSchema` via `.omit`/`.extend`.
- **`beneficiaryOrderSettingsSchema` / `BeneficiaryOrderSettingsInput`** (added Jul 2026): upsert body for `PUT /transporter/beneficiaries/:id/order-settings`. All fields optional/nullable (`transportValue`, `currency` max 8, `paymentTermDays` 0-365, `baleCount`, `baleDimensions`, `goodsName`, `truckDescription`, `loadingLocality`, `loadingCountry`, `obs`) — the server applies defaults (currency `EUR`, `paymentTermDays` 30) on first insert. See [[packages-types]] `BeneficiaryOrderSettings`.
- `verifyPortalCodeSchema` / `VerifyPortalCodeInput`: `{ code: portalCodeSchema }`.
- `signTripSchema` / `SignTripInput`: `{ signature: signatureUrlSchema }` — driver's public sign-and-leave submission.
- `updateOrgRequestSettingsSchema` / `UpdateOrgRequestSettingsInput`: `requestAccessCode` (portal code, nullable), `allowedCropTypes` (array, max 20).
- **`confirmTripRequestSchema` / `ConfirmTripRequestInput`**: admin/dispatcher confirm body. Optional `internalCode` (override for the spawned aux truck). **As of Jul 2026 the pickup source is `depotId` OR `parcelId` (both optional, XOR-refined)** — previously `depotId` alone was required; a dispatcher can now confirm against a field instead of a depot, mirroring the `registerLoadSchema`/`forceStatusSchema` XOR in `trip-transition.schema.ts`.
- `cancelTripRequestSchema`: optional `reason` (max 500).

See [[packages-types]] for the corresponding TypeScript interfaces and [[database]] for the backing SQL schema.

## DTO Schemas

### Trip Create (`dtos/trip-create.schema.ts`)

`tripCreateDtoSchema`: `sourceParcelId`, `truckId`, `driverId` (UUIDs required). Optional `loaderId`, `loaderOperatorId`, `destinationId` (UUID, added Jul 2026 — FK to the destination depot, what the depot-manager pull and RLS key on), `destinationName`, `destinationAddress`, `destinationCoords` (geoPoint).

### Multi-Iteration Trip DTOs

- `nextIterationDtoSchema`: DTO for creating the next trip iteration on the same course (Plan C). Contains reference to parent trip and loader recall answer.
- `loaderRecallResponseSchema`: `{ tripId: UUID, recallAnswer: 'yes' | 'no' }` — mobile loader's response to a truck-idle recall prompt sent via push notification.

### Trip Transitions (`dtos/trip-transition.schema.ts`)

| Schema | Required Fields | Validation Rules |
|---|---|---|
| `startLoadingSchema` | `loaderOperatorId` (UUID) | `loaderId` optional UUID |
| `completeLoadingSchema` | (empty object) | `loaderSignature` optional base64/URL string |
| `departSchema` | (empty object) | **Driver signature removed Jul 2026** (commit `5a8ce2a`) — the mobile screen resent the driver's saved specimen verbatim on every retry, so a malformed cached specimen wedged the trip on `loaded` forever; the field is deliberately *absent* (not optional) so a stale queued payload is silently stripped by Zod instead of rejected. Distance is derived entirely from GPS, so there is no odometer field either. |
| `arriveSchema` | (empty object) | Trip distance comes from the GPS track (depart → arrive) |
| `startDeliverySchema` | -- | optional `destinationName` |
| `confirmDeliverySchema` | -- | `grossWeightKg`/`tareWeightKg` now `positive`/`nonnegative`, **nullable + optional**; optional `weightTicketNumber`, `weightTicketPhotoUrl` (back-compat only), `deterioratedBalesCount` (nonneg int, nullable); `scaleBroken` optional boolean (Jul 2026 — delivery without weighing at a self-confirmed depot). Refined: either `scaleBroken === true` or `grossWeightKg` is present; `tareWeightKg` (if present) must be ≤ `grossWeightKg`. |
| `completeSchema` | `receiverName` (min 1) | **Receiver signature removed Jul 2026** (commit `b6beb2e`) — same "stuck-retry" failure mode as `departSchema`; the field is intentionally absent so a stale queued payload is stripped, not rejected. |
| `confirmDepotDeliverySchema` | `baleCount` (positive int), `depotOperatorSignature`, `idempotencyKey` (UUID) | Added Jul 2026 — depot-operator confirmation. `grossWeightKg`/`tareWeightKg`/`scaleBroken` optional (a `principal` depot with a working scale sends weights; a `temporary` depot or broken scale omits them, enforced server-side — the schema can't see depot type). Same tare-≤-gross refinement as `confirmDeliverySchema`. |
| `cancelSchema` | `cancellationReason` | min 1 |
| `forceStatusSchema` | `status` (enum) | Admin-only manual override, bypasses the state machine. Optional `reason`, `expectedStatus` (optimistic-lock guard). Optional `baleCount` (positive int) + exactly one of `parcelId`/`sourceDepotId` (XOR, refined) + `idempotencyKey` — required together when the override implies a load was picked up, so forcing a trip to `loaded`+ now inserts a real `bale_loads` row instead of leaving a phantom 0-bale trip. |
| `disputeSchema` | `reason` | min 1 |
| `resolveDisputeSchema` | `resolutionNotes`, `resolvedTo` | min 1; enum `['delivered','completed']` |
| `registerLoadSchema` | `truckId`, `loaderMachineId`, `baleCount` (positive int), `idempotencyKey` (UUID) | Atomic loader "register load": finds/creates the trip for (truck, today), inserts `bale_loads`, transitions to `loaded`. Exactly one of `parcelId`/`sourceDepotId` required (XOR, refined — goods come off a field or out of a depot). Optional `gpsLat`/`gpsLon`, `loaderSignature` (bounded `max(4096)` but **not validated as a URL** — the server resolves the real specimen from `users.signature_specimen_url` server-side and ignores this value; a strict allowlist here previously locked a loader operator out for six days). |

### Sync Payloads (`dtos/sync-payload.schema.ts`)

- `syncMutationSchema`: `table` (min 1), `recordId` (UUID), `action` enum, `data` record, `clientId` (min 1), `clientVersion` (nonneg int), `idempotencyKey` (min 1).
- `syncPushRequestSchema`: `{ mutations: syncMutation[] }`.
- `syncPullRequestSchema`: `{ tables: Record<string, nonneg int> }`.

### Dashboard (`dtos/dashboard.schema.ts`)

- `dashboardOverviewSchema`: Six nonneg int counters.
- `productionReportSchema`: `produced`/`loaded`/`delivered` (nonneg int), `lossPercentage` (nonneg).
- `costReportSchema`: `entityType` enum `["parcel","machine"]`, three nonneg cost fields.
- `antiFraudReportSchema`: Four nonneg int counters plus `recentAlerts: alertSchema[]`.
