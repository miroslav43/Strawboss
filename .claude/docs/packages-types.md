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

**Enum `UserRole`:** `admin`, `dispatcher`, `baler_operator`, `loader_operator`, `driver`

| Field | Type |
|---|---|
| `id` | `string` (UUID) |
| `email` | `string` |
| `phone` | `string \| null` |
| `fullName` | `string` |
| `role` | `UserRole` |
| `isActive` | `boolean` |
| `locale` | `string` |
| `avatarUrl` | `string \| null` |
| `lastLoginAt` | `string \| null` |
| `assignedMachineId` | `string \| null` |

### Farm (`entities/farm.ts`)

Simple grouping entity with inline timestamps (no mixin).

Fields: `id`, `name`, `address`, `createdAt`, `updatedAt`, `deletedAt`.

### Parcel (`entities/parcel.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `ParcelStatus`:** `active`, `inactive`
**Enum `HarvestStatus`:** `planned`, `to_harvest`, `harvesting`, `harvested`

Fields: `id`, `code`, `name`, `ownerName`, `ownerContact`, `areaHectares`, `boundary` (GeoJSON string), `centroid` (GeoPoint), `address`, `municipality`, `farmtrackGeofenceId`, `farmId`, `notes`, `isActive`, `harvestStatus`.

### Machine (`entities/machine.ts`)

Extends `Timestamps`, `SoftDelete`.

**Enum `MachineType`:** `truck`, `loader`, `baler`
**Enum `FuelType`:** `diesel`, `gasoline`, `electric`

Fields: `id`, `machineType`, `registrationPlate`, `internalCode`, `make`, `model`, `year`, `fuelType`, `tankCapacityLiters`, `farmtrackDeviceId`, `currentOdometerKm`, `currentHourmeterHrs`, `isActive`, `maxPayloadKg`, `maxBaleCount`, `tareWeightKg`, `balesPerHourAvg`, `baleWeightAvgKg`, `reachMeters`.

### Trip (`entities/trip.ts`)

Extends `Timestamps`, `SoftDelete`. The core domain entity.

**Enum `TripStatus`:** `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`, `cancelled`, `disputed`

Key fields: `tripNumber`, `status`, `sourceParcelId`, `sourceParcelAuto`, `loaderId`, `truckId`, `loaderOperatorId`, `driverId`, `baleCount`, timestamps for each phase (`loadingStartedAt` through `completedAt`), odometer readings (`departureOdometerKm`, `arrivalOdometerKm`), destination info, weight data (`grossWeightKg`, `tareWeightKg`, `netWeightKg`), receiver info (`receiverName`, `receiverSignatureUrl`), `fraudFlags`, `clientId`, `syncVersion`.

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
**Enum `DocumentStatus`:** `pending`, `generating`, `generated`, `sent`, `failed`

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

## DTOs

- **TripCreateDto** (`dtos/trip-create.dto.ts`): `sourceParcelId`, `truckId`, `driverId`, optional `loaderId`, `loaderOperatorId`, `destinationName`, `destinationAddress`, `destinationCoords`.
- **Trip transition DTOs** (`dtos/trip-transition.dto.ts`): `StartLoadingDto`, `CompleteLoadingDto`, `DepartDto`, `ArriveDto`, `StartDeliveryDto`, `ConfirmDeliveryDto`, `CompleteDto`, `CancelDto`, `DisputeDto`, `ResolveDisputeDto`.
- **SyncPushRequest / SyncPullRequest / SyncResponse** (`dtos/sync-payload.dto.ts`): See [sync-protocol.md](sync-protocol.md).
- **Dashboard DTOs** (`dtos/dashboard.dto.ts`): `DashboardOverview`, `ProductionReport`, `CostReport`, `AntiFraudReport`.
- **LocationReportDto** (`dtos/location-report.dto.ts`): `machineId`, `lat`, `lon`, optional `accuracyM`, `headingDeg`, `speedMs`, `recordedAt`.
- **RouteHistoryResponse** (`dtos/route-history.dto.ts`): `machineId`, `machineCode`, `machineType`, `from`, `to`, `totalPoints`, `points: RoutePoint[]`.
