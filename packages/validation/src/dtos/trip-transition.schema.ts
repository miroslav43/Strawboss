import { z } from 'zod';
import { uuidSchema } from '../helpers/uuid.js';

export const startLoadingSchema = z.object({
  loaderId: uuidSchema.optional(),
  loaderOperatorId: uuidSchema,
});

export const completeLoadingSchema = z.object({});

// Driver signature was dropped from departure too — the mobile screen resends
// the driver's saved specimen verbatim on every attempt (never a fresh
// capture), so a specimen that predates a signatureUrlSchema tightening (or
// is otherwise malformed) fails the same way on every retry forever, wedging
// the trip on 'loaded' and cascading "transition not allowed" onto every
// later step. The field is intentionally absent (not just optional) so a
// stale queued payload gets it silently stripped by zod's default strip
// behavior instead of rejected. Mirrors completeSchema's receiverSignature removal.
export const departSchema = z.object({});

// Trip distance comes entirely from the GPS track (depart → arrive), so the
// arrive payload carries no fields.
export const arriveSchema = z.object({});

export const startDeliverySchema = z.object({
  destinationName: z.string().optional(),
});

export const confirmDeliverySchema = z
  .object({
    // Driver weighs the loaded truck (gross) and the empty truck (tare) at the
    // depot weighbridge; net = gross - tare is computed in the DB. Both are
    // nullable — a driver delivering to a depot with no working scale sets
    // `scaleBroken` instead, mirroring confirmDepotDeliverySchema.
    grossWeightKg: z.number().positive().nullable().optional(),
    tareWeightKg: z.number().nonnegative().nullable().optional(),
    weightTicketNumber: z.string().optional(),
    // Weight-ticket photo was removed from the flow; kept optional for back-compat.
    weightTicketPhotoUrl: z.string().optional(),
    // Mobile sends `null` when the (now-removed) damaged-bales step is skipped —
    // accept null as well as a number/absent, otherwise confirm-delivery 400s.
    deterioratedBalesCount: z.number().int().min(0).nullable().optional(),
    scaleBroken: z.boolean().optional(),
  })
  // Either the scale was skipped, or a gross weight was actually captured.
  .refine((d) => d.scaleBroken === true || d.grossWeightKg != null, {
    message: 'Este necesară greutatea brută (sau livrare fără cântărire)',
    path: ['grossWeightKg'],
  })
  // Tare can never exceed gross (net would be negative). Reject instead of
  // letting the backend clamp it to net=0 on a legally binding CMR.
  .refine(
    (d) => d.grossWeightKg == null || d.tareWeightKg == null || d.tareWeightKg <= d.grossWeightKg,
    {
      message: 'Tara nu poate depăși greutatea brută',
      path: ['tareWeightKg'],
    },
  );

// Receiver signature was dropped from the driver's self-confirm delivery flow —
// a failed binary upload used to fall back to a raw base64 string that could
// never pass signatureUrlSchema, permanently stuck-retrying `complete` in the
// sync queue. The field is intentionally absent (not just optional) so a
// stale queued payload from an old app build gets it silently stripped by
// zod's default strip behavior instead of rejected.
export const completeSchema = z.object({
  receiverName: z.string().min(1),
});

/**
 * Depot-operator confirmation payload. `baleCount` is always required; weights
 * are optional (omitted on a temporary depot or when the scale is broken). The
 * depot-type rule — "principal depot with a working scale must send gross" — is
 * enforced server-side (the schema can't see the depot type). The cross-field
 * tare ≤ gross check applies only when both weights are present.
 */
export const confirmDepotDeliverySchema = z
  .object({
    baleCount: z.number().int().positive(),
    grossWeightKg: z.number().positive().nullable().optional(),
    tareWeightKg: z.number().nonnegative().nullable().optional(),
    scaleBroken: z.boolean().optional(),
    /*
     * NOT `signatureUrlSchema`, deliberately — mirrors registerLoadSchema's
     * `loaderSignature` for the same reason. The depot operator's signature is
     * always their pre-registered specimen; the server resolves the real value
     * from `users.signature_specimen_url` and ignores this field
     * (TripsService.resolveSpecimenSignature), so it never reaches an
     * `<img src>` and needs no allowlist.
     *
     * Validating it strictly here was the exact same failure mode as the
     * loader incident (111d4b1): a failed binary upload on the phone fell back
     * to raw base64, which can never pass a strict URL regex, permanently
     * wedging `confirm-depot-delivery` in the sync queue. Bounded to keep the
     * body sane; never trusted.
     */
    depotOperatorSignature: z.string().max(4096).optional(),
    idempotencyKey: uuidSchema,
  })
  .refine(
    (d) => d.grossWeightKg == null || d.tareWeightKg == null || d.tareWeightKg <= d.grossWeightKg,
    {
      message: 'Tara nu poate depăși greutatea brută',
      path: ['tareWeightKg'],
    },
  );

export const cancelSchema = z.object({
  cancellationReason: z.string().min(1),
});

/**
 * Admin-only manual status override. Bypasses the state machine — lets an admin
 * force a trip into any status to recover from stuck/edge situations.
 */
const tripStatusEnum = z.enum([
  'planned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivering',
  'delivered',
  'completed',
  'cancelled',
  'disputed',
]);

/**
 * Admin status override, optionally carrying the load that the override implies.
 *
 * Forcing a trip to `loaded` (or beyond) used to move only the status — leaving a
 * phantom trip with 0 bales, no source and no stock movement. Supplying the load
 * here makes the override insert a real `bale_loads` row, which IS the stock
 * deduction (parcel remaining is derived, not stored).
 *
 * The XOR mirrors `registerLoadSchema` below: goods come off a field or out of a
 * depot, never both. `baleCount` and a source travel together — a count with no
 * source cannot be attributed, and a source with no count deducts nothing.
 */
export const forceStatusSchema = z
  .object({
    status: tripStatusEnum,
    reason: z.string().optional(),
    expectedStatus: tripStatusEnum.optional(),
    baleCount: z.number().int().positive().optional(),
    parcelId: uuidSchema.optional(),
    sourceDepotId: uuidSchema.optional(),
    idempotencyKey: uuidSchema.optional(),
  })
  .refine((d) => (d.baleCount === undefined ? true : !!d.parcelId !== !!d.sourceDepotId), {
    message: 'exactly one of parcelId or sourceDepotId is required when baleCount is given',
  })
  .refine((d) => (d.parcelId || d.sourceDepotId ? d.baleCount !== undefined : true), {
    message: 'baleCount is required when a source is given',
  });

export const disputeSchema = z.object({
  reason: z.string().min(1),
});

export const resolveDisputeSchema = z.object({
  resolutionNotes: z.string().min(1),
  resolvedTo: z.enum(['delivered', 'completed']),
});

/**
 * Atomic loader "register load" payload — finds or creates the trip for
 * (truck, today), inserts a `bale_loads` row, and transitions the trip to
 * `loaded` in a single transaction.
 *
 * `idempotencyKey` is the client-side bale_load UUID so retries dedupe.
 */
export const registerLoadSchema = z
  .object({
    truckId: uuidSchema,
    loaderMachineId: uuidSchema,
    parcelId: uuidSchema.optional(),
    sourceDepotId: uuidSchema.optional(),
    baleCount: z.number().int().positive(),
    gpsLat: z.number().min(-90).max(90).optional(),
    gpsLon: z.number().min(-180).max(180).optional(),
    idempotencyKey: uuidSchema,
    /*
     * NOT `signatureUrlSchema`, deliberately — this is only the loader echoing
     * back the specimen URL they cached at login. The server now RESOLVES the
     * real specimen from `users.signature_specimen_url` and ignores this value
     * (TripsService.resolveSpecimenSignature), so it cannot reach an `<img src>`
     * and needs no allowlist. `depotOperatorSignature` on
     * `confirmDepotDeliverySchema` follows the same pattern for the same
     * reason; `driverSignature`/`receiverSignature` were dropped from
     * `departSchema`/`completeSchema` entirely since driver/receiver
     * signatures are no longer collected at all.
     *
     * Validating it here was actively harmful: the audit (111d4b1) swapped
     * `z.string()` for the strict allowlist, and every phone whose cached URL no
     * longer matched had its LOADS REJECTED at the validation boundary — the request
     * died before the service ever ran, over a field the service was going to
     * overwrite anyway. A loader operator was locked out for six days by it.
     *
     * Bounded to keep the body sane; never trusted.
     */
    loaderSignature: z.string().max(4096).optional(),
  })
  .refine((d) => !!d.parcelId !== !!d.sourceDepotId, {
    message: 'exactly one of parcelId or sourceDepotId is required',
  });
