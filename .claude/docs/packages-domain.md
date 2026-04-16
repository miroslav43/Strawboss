# @strawboss/domain

Pure business logic with no I/O. Contains the XState v5 trip state machine, fraud detection algorithms, bale/fuel reconciliation, alert evaluation, task assignment rules, CMR completeness checks, and geo utilities.

**Source:** `packages/domain/src/`

## Trip State Machine (`state-machines/trip.machine.ts`)

Built with XState v5 (`setup` + `createMachine`). Ten states, ten event types.

### States and Transitions

```
planned ──START_LOADING──> loading ──COMPLETE_LOADING──> loaded ──DEPART──> in_transit
    |                         |                            |                    |
    CANCEL                   CANCEL                      CANCEL              ARRIVE
    v                         v                            v                    v
cancelled                  cancelled                   cancelled            arrived
                                                                               |
                                                                          START_DELIVERY
                                                                               v
completed <──COMPLETE── delivered <──CONFIRM_DELIVERY── delivering
    |                    |   ^                              |
    DISPUTE           DISPUTE |                           CANCEL
    v                    v    |                              v
    disputed ──────────────── RESOLVE_DISPUTE            cancelled
```

### Guards

| Guard | Validates |
|---|---|
| `hasLoaderOperatorId` | `event.loaderOperatorId` is a non-empty string |
| `hasBaleLoads` | `context.hasBaleLoads === true` |
| `hasDepartureOdometer` | `event.departureOdometerKm` is a number >= 0 |
| `hasArrivalOdometer` | `event.arrivalOdometerKm` is a number >= 0 |
| `hasGrossWeight` | `event.grossWeightKg` is a number > 0 |
| `hasReceiverInfo` | `event.receiverName` and `event.receiverSignature` are non-empty strings |
| `hasCancellationReason` | `event.cancellationReason` is a non-empty string |

### Context (`TripMachineContext`)

Fields: `tripId`, `status`, `baleCount`, `hasBaleLoads`, `departureOdometerKm`, `arrivalOdometerKm`, `grossWeightKg`, `receiverName`, `receiverSignature`, `loaderId`, `loaderOperatorId`, `destinationName`, `cancelledAt`, `cancellationReason`.

### Key Functions

- `createTripMachine(initialContext)`: Creates an XState actor with the given initial context.
- `getAvailableTransitions(status: TripStatus): string[]`: Returns valid event names for a given status. Used by all ten workflow endpoints to validate before updating.

### CANCEL Availability

CANCEL is available from every non-terminal state: `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`. The `cancelled` state is `type: "final"`. The `completed` state cannot be cancelled, only disputed.

### DISPUTE / RESOLVE_DISPUTE

DISPUTE is available from `delivered` and `completed`. RESOLVE_DISPUTE from `disputed` can target either `delivered` or `completed` based on `event.resolvedTo`.

## Fraud Detection (`fraud-detection/`)

### Odometer-GPS Discrepancy (`odometer-gps.ts`)

`checkOdometerGpsDiscrepancy(input: OdometerGpsInput): OdometerGpsResult`

- Computes `odometerDistanceKm = arrival - departure`.
- Calculates `discrepancyPercent = |odometerDistance - gpsDistance| / gpsDistance * 100`.
- Flags `isSuspicious` when `discrepancyPercent > tolerancePercent`.

### Fuel Anomaly Detection (`fuel-anomaly.ts`)

`detectFuelAnomaly(input: FuelAnomalyInput): FuelAnomalyResult`

- Statistical z-score analysis: computes mean and standard deviation of historical readings.
- `zScore = |currentReading - mean| / stdDev`.
- If `stdDev === 0` and values differ, zScore is `Infinity`.
- Flags `isAnomaly` when `zScore > stdDevThreshold`.

### Timing Anomaly Detection (`timing-anomaly.ts`)

`checkTimingAnomaly(input: TimingAnomalyInput): TimingAnomalyResult`

- `avgSpeedKmh = distanceKm / (durationMinutes / 60)`.
- `isTooFast` if exceeds `maxSpeedKmh` (physically impossible trip).
- `isTooSlow` if nonzero but below `minSpeedKmh` (suspicious delay).

## Reconciliation (`reconciliation/`)

### Bale Reconciliation (`bale-reconciliation.ts`)

`reconcileBales(input: BaleReconciliationInput): BaleReconciliationResult`

- Tracks three counts per parcel: `produced`, `loaded`, `delivered`.
- `loadedVsProducedDiff = loaded - produced` (should be 0 or negative).
- `deliveredVsLoadedDiff = delivered - loaded` (should be 0).
- `lossPercentage = (produced - delivered) / produced * 100`.
- `hasDiscrepancy` is true if either diff is nonzero.

### Fuel Reconciliation (`fuel-reconciliation.ts`)

`reconcileFuel(input: FuelReconciliationInput): FuelReconciliationResult`

- `expectedFuelLiters = distanceKm * expectedConsumptionLPerKm`.
- `deviationPercent = (actual - expected) / expected * 100`.
- `isAnomaly` when `|deviationPercent| > tolerancePercent`.

## Alert Evaluation (`alerts/alert-evaluators.ts`)

`evaluateAlerts(input: AlertInput): AlertDraft[]`

Aggregates results from all fraud/reconciliation checks and generates typed alert drafts:

| Trigger | Category | Severity Logic |
|---|---|---|
| `odometerGps.isSuspicious` | `fraud` | >50% = critical, >30% = high, >15% = medium, else low |
| `fuelAnomaly.isAnomaly` | `anomaly` | zScore >4 = critical, >3 = high, else medium |
| `timingAnomaly.isSuspicious` | `fraud` (too fast) or `anomaly` (too slow) | too fast = high, too slow = medium |
| `baleReconciliation.hasDiscrepancy` | `anomaly` | loss >10% = high, else medium |

Each `AlertDraft` includes: `category`, `severity`, `title`, `description`, `tripId`, `machineId`, `data` (evidence record).

## Business Rules (`rules/`)

### Task Assignment Validation (`rules/task-assignment.ts`)

`validateTaskAssignment(input: AssignmentValidationInput): AssignmentValidationResult`

Two checks against existing assignments for the same date:
1. **No machine double-booking**: same `machineId` + `assignmentDate` (excluding self by id).
2. **No user double-booking**: same `assignedUserId` + `assignmentDate` (excluding self by id).

### CMR Completeness (`rules/cmr-completeness.ts`)

`checkCmrCompleteness(input: CmrCompletenessInput): CmrCompletenessResult`

Checks 12 required fields for CMR document generation: `tripNumber`, `sourceParcelName`, `destinationName`, `destinationAddress`, `driverName`, `truckRegistration`, `baleCount`, `grossWeightKg`, `netWeightKg`, `receiverName`, `receiverSignedAt`, `deliveredAt`. Returns `isComplete` and `missingFields[]`.

## Geo Utilities (`utils/geo-distance.ts`)

- `calculateDistance(point1: GeoPoint, point2: GeoPoint): number` -- Haversine formula, returns km.
- `calculateTotalDistance(points: GeoPoint[]): number` -- Sum of sequential pairwise distances.
