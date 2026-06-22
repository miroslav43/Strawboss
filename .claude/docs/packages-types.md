---
type: doc
title: "@strawboss/types"
created: 2026-04-16
updated: 2026-06-22
tags: [doc, package, types, typescript]
status: mature
related:
  - "[[architecture]]"
  - "[[database]]"
  - "[[packages-validation]]"
  - "[[packages-domain]]"
  - "[[backend]]"
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

## Entities

### User (`entities/user.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `UserRole`:** `super_admin`, `admin`, `dispatcher`, `baler_operator`, `loader_operator`, `driver`, `geofence_maker`, `depot_manager`

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
| `locale` | `string` |
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

Fields: `id`, `machineType`, `registrationPlate`, `internalCode`, `make`, `model`, `year`, `fuelType`, `tankCapacityLiters`, `farmtrackDeviceId`, `currentOdometerKm`, `currentHourmeterHrs`, `isActive`, `maxPayloadKg`, `maxBaleCount`, `tareWeightKg`, `balesPerHourAvg`, `baleWeightAvgKg`, `reachMeters`, `companyName`, `companyAddress`.

### Trip (`entities/trip.ts`)

Extends `Timestamps`, `SoftDelete`. The core domain entity.

**Enum `TripStatus`:** `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`, `cancelled`, `disputed`

Key fields: `tripNumber`, `status`, `sourceParcelId`, `sourceParcelAuto`, `loaderId`, `truckId`, `loaderOperatorId`, `driverId`, `baleCount`, timestamps for each phase (`loadingStartedAt` through `completedAt`), odometer readings (`departureOdometerKm`, `arrivalOdometerKm`), destination info, weight data (`grossWeightKg`, `tareWeightKg`, `netWeightKg`), receiver info (`receiverName`, `receiverSignatureUrl`), `loaderSignatureUrl` (set at complete-loading), `driverSignatureUrl` (set at depart), `deterioratedBalesCount` (set at confirm-delivery), `fraudFlags`, `clientId`, `syncVersion`, `parentTripId: string | null` (Plan C multi-iteration), `iterationIndex: number` (1-based, default 1).

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

**Enum `DocumentType`:** `cmr`, `invoice`, `delivery_note`, `weight_ticket`, `report`
**Enum `DocumentStatus`:** `pending`, `generating`, `partial`, `generated`, `sent`, `failed`

Fields: `id`, `tripId`, `documentType`, `status`, `title`, `fileUrl`, `fileSizeBytes`, `mimeType`, `metadata` (JSONB), `generatedAt`, `sentAt`, `sentTo` (string array).

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
- **MachineLastLocation** (same file): aggregated view with `machineCode`, `machineType`, `operatorName`, `assignedUserId`, `assignedUserName`.
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

**`FleetDeviceListItem`** extends `Device`. List-row enriched with joins: `organizationName: string | null`, `latestOtaState: OtaState | null`, `latestDeploymentId: string | null`.

**`AppRelease`** extends `Timestamps`, `SoftDelete`. `id`, `version`, `versionCode`, `apkKey` (storage path under `UPLOADS_ROOT`), `sha256` (hex digest verified on-device), `sizeBytes`, `changelog: string | null`, `mandatory: boolean`, `status: ReleaseStatus`, `uploadedBy: string | null`.

**`OtaDeployment`** extends `Timestamps` (no SoftDelete). `id`, `releaseId`, `targetKind: OtaTargetKind`, `targetOrgId: string | null`, `targetDeviceIds: string[] | null`, `scheduledAt: string | null` (null = immediate), `forceNow: boolean`, `status: OtaDeploymentStatus`, `createdBy: string | null`.

**`DeviceOtaStatus`** (standalone, no mixins). `id`, `deploymentId`, `deviceId`, `state: OtaState`, `error: string | null`, `attempt: number`, `notifiedAt`, `downloadedAt`, `installedAt`, `updatedAt`.

#### Check-in Protocol Interfaces

**`DeviceOtaReport`**: A device-driven OTA state transition reported on check-in. `deploymentId`, `state: OtaState`, `error?: string`.

**`DeviceCheckinRequest`**: Device → backend (PUBLIC endpoint). `deviceUuid`, `deviceToken?` (omitted on first registration), `appVersion`, `versionCode`, `model?`, `manufacturer?`, `osVersion?`, `androidId?`, `pushToken?`, `isDeviceOwner: boolean`, `activeTrip: boolean`, `otaReports?: DeviceOtaReport[]`, `lastError?`.

**`PendingDeployment`**: The signed APK + install policy returned when an update is pending. `deploymentId`, `releaseId`, `version`, `versionCode`, `apkUrl` (signed time-limited download URL), `sha256`, `sizeBytes`, `installPolicy: { forceNow: boolean; mandatory: boolean }`.

**`DeviceCheckinResponse`**: Backend → device. `deviceId`, `assignedOrgId: string | null`, `deviceTokenIssued?: string` (present ONLY on the first registration response — the raw HMAC token to persist), `pendingDeployment: PendingDeployment | null`.

See [[database]] for the backing SQL enums and [[packages-validation]] for the corresponding Zod schemas.

## DTOs

- **TripCreateDto** (`dtos/trip-create.dto.ts`): `sourceParcelId`, `truckId`, `driverId`, optional `loaderId`, `loaderOperatorId`, `destinationName`, `destinationAddress`, `destinationCoords`.
- **Trip transition DTOs** (`dtos/trip-transition.dto.ts`): `StartLoadingDto`, `CompleteLoadingDto`, `DepartDto`, `ArriveDto`, `StartDeliveryDto`, `ConfirmDeliveryDto`, `CompleteDto`, `CancelDto`, `DisputeDto`, `ResolveDisputeDto`.
- **SyncPushRequest / SyncPullRequest / SyncResponse** (`dtos/sync-payload.dto.ts`): See [sync-protocol.md](sync-protocol.md).
- **Dashboard DTOs** (`dtos/dashboard.dto.ts`): `DashboardOverview`, `ProductionReport`, `CostReport`, `AntiFraudReport`.
- **LocationReportDto** (`dtos/location-report.dto.ts`): `machineId`, `lat`, `lon`, optional `accuracyM`, `headingDeg`, `speedMs`, `recordedAt`.
- **RouteHistoryResponse** (`dtos/route-history.dto.ts`): `machineId`, `machineCode`, `machineType`, `from`, `to`, `totalPoints`, `points: RoutePoint[]`.
- **KmByDayResponse** (`dtos/route-history.dto.ts`): `machineId`, `from`, `to`, `days: { date: string; km: number }[]`.
