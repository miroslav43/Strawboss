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

- `createFarmSchema`: `name` (string, min 1, required), `address` (string, optional).
- `updateFarmSchema`: All fields from create, partial.

### User (`schemas/user.schema.ts`)

- `userRoleSchema`: `z.nativeEnum(UserRole)`.
- `userSchema`: Full entity with UUID id, `email` (z.string().email()), `fullName` (min 1), all fields merged with timestamps/softDelete.
- `createUserSchema`: `email` (email), `fullName` (min 1), `role`, optional `phone`.
- `updateUserSchema`: `email`, `fullName`, `role`, `phone`, `isActive`, `locale`, `avatarUrl` -- all partial.

### Profile (`schemas/profile.schema.ts`)

- `updateProfileLocaleSchema`: `locale` restricted to `z.enum(["en", "ro"])`.
- `updateProfileSchema`: optional `fullName` (min 1), `phone`, `locale` (en/ro), `notificationPrefs` (Record<string, boolean>).
- `changePasswordSchema`: `currentPassword` (min 1), `newPassword` (min 8).

### Parcel (`schemas/parcel.schema.ts`)

- `harvestStatusSchema`: `z.enum(["planned", "to_harvest", "harvesting", "harvested"])`.
- `parcelSchema`: Full entity. `areaHectares` must be positive. `centroid` validated as geoPoint.
- `createParcelSchema`: All fields optional (code and name auto-generated). `areaHectares` positive.
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
- `mobileLogIngestSchema`: `entries` array min 1 max 200.

## DTO Schemas

### Trip Create (`dtos/trip-create.schema.ts`)

`tripCreateDtoSchema`: `sourceParcelId`, `truckId`, `driverId` (UUIDs required). Optional `loaderId`, `loaderOperatorId`, `destinationName`, `destinationAddress`, `destinationCoords` (geoPoint).

### Trip Transitions (`dtos/trip-transition.schema.ts`)

| Schema | Required Fields | Validation Rules |
|---|---|---|
| `startLoadingSchema` | `loaderOperatorId` (UUID) | `loaderId` optional UUID |
| `completeLoadingSchema` | (empty object) | -- |
| `departSchema` | `departureOdometerKm` | nonnegative number |
| `arriveSchema` | `arrivalOdometerKm` | nonnegative number |
| `startDeliverySchema` | -- | optional `destinationName` |
| `confirmDeliverySchema` | `grossWeightKg` | positive number; optional `weightTicketNumber` |
| `completeSchema` | `receiverName`, `receiverSignature` | both min 1 |
| `cancelSchema` | `cancellationReason` | min 1 |
| `disputeSchema` | `reason` | min 1 |
| `resolveDisputeSchema` | `resolutionNotes`, `resolvedTo` | min 1; enum `['delivered','completed']` |

### Sync Payloads (`dtos/sync-payload.schema.ts`)

- `syncMutationSchema`: `table` (min 1), `recordId` (UUID), `action` enum, `data` record, `clientId` (min 1), `clientVersion` (nonneg int), `idempotencyKey` (min 1).
- `syncPushRequestSchema`: `{ mutations: syncMutation[] }`.
- `syncPullRequestSchema`: `{ tables: Record<string, nonneg int> }`.

### Dashboard (`dtos/dashboard.schema.ts`)

- `dashboardOverviewSchema`: Six nonneg int counters.
- `productionReportSchema`: `produced`/`loaded`/`delivered` (nonneg int), `lossPercentage` (nonneg).
- `costReportSchema`: `entityType` enum `["parcel","machine"]`, three nonneg cost fields.
- `antiFraudReportSchema`: Four nonneg int counters plus `recentAlerts: alertSchema[]`.
