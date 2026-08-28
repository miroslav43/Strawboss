import { z } from 'zod';
import { geoPointSchema } from '../helpers/geo.js';
import { isoDateSchema } from '../helpers/iso-date.js';
import { uuidSchema } from '../helpers/uuid.js';
import { signatureUrlSchema } from '../helpers/signature-url.js';
import { cropTypeSchema } from './parcel.schema.js';

/** 4-digit portal access code. */
export const portalCodeSchema = z.string().regex(/^\d{4}$/, 'Code must be exactly 4 digits');

/** Public submission payload for the external request portal (no auth). */
// All fields are required EXCEPT driverEmail, notes, and destinationCoords
// (the public form does not capture coords). truckMake / destinationLocality
// were dropped from the form entirely.
export const createTripRequestSchema = z.object({
  // who is requesting
  requesterName: z.string().min(1).max(120),
  requesterPhone: z.string().min(4).max(40),
  requesterEmail: z.string().email().max(160),
  companyName: z.string().min(1).max(160),
  companyAddress: z.string().min(1).max(300),
  companyCui: z.string().min(1).max(40),
  // their truck
  truckRegistrationPlate: z.string().min(1).max(40),
  truckModel: z.string().min(1).max(80),
  truckCapacityTons: z.number().positive().max(1000),
  // their driver (no app account)
  driverName: z.string().min(1).max(120),
  driverPhone: z.string().min(4).max(40),
  driverEmail: z.string().email().max(160).nullable().optional(),
  // the ask
  cropType: cropTypeSchema,
  neededDate: isoDateSchema,
  tonsRequested: z.number().positive().max(100000),
  destinationAddress: z.string().min(1).max(300),
  destinationCoords: geoPointSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateTripRequestInput = z.infer<typeof createTripRequestSchema>;

/** Beneficiary portal submission — replaces truck make/model with transporter fields. */
export const createBeneficiaryRequestSchema = z.object({
  // who is requesting (contact person)
  requesterName: z.string().min(1).max(120),
  requesterPhone: z.string().min(4).max(40),
  requesterEmail: z.string().email().max(160).nullable().optional(),
  // their truck
  truckRegistrationPlate: z.string().min(1).max(40),
  trailerRegistrationPlate: z.string().max(40).nullable().optional(),
  truckCapacityTons: z.number().positive().max(1000).nullable().optional(),
  // transporter company
  transporterName: z.string().max(200).nullable().optional(),
  transporterCui: z.string().max(20).nullable().optional(),
  transporterAddress: z.string().max(300).nullable().optional(),
  // their driver (no app account)
  driverName: z.string().min(1).max(120),
  driverPhone: z.string().min(4).max(40),
  driverEmail: z.string().email().max(160).nullable().optional(),
  // the ask — the beneficiary portal captures a quality grade + date + destination
  // + notes. cropType / tonsRequested were dropped from the form and stay optional
  // (inserted as NULL) so older clients / data remain valid.
  //
  // The destination came BACK: without it the dispatcher could see that a truck was
  // coming but not where it had to go, and the "Destinație" column on the Curse
  // page was empty for every beneficiary request. Optional, because older clients
  // still post without it.
  quality: z.enum(['quality_1', 'quality_2']),
  cropType: cropTypeSchema.nullable().optional(),
  neededDate: isoDateSchema,
  // Comandă: the unloading/delivery date (loading date = neededDate). Only the
  // transporter form sends it; the public portal omits it → NULL.
  unloadingDate: isoDateSchema.nullable().optional(),
  tonsRequested: z.number().positive().max(100000).nullable().optional(),
  destinationAddress: z.string().min(1).max(300).nullable().optional(),
  destinationLocality: z.string().min(1).max(160).nullable().optional(),
  destinationCoords: geoPointSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Which saved contacts to notify (email + SMS) on confirm, 1..10. The first is
  // the primary — its fields still populate requesterName/Phone/Email above. The
  // server re-resolves every id from the beneficiary's saved contacts, so a
  // public submission can only notify its own saved contacts (no arbitrary
  // addresses). `contactId` is kept for back-compat (deprecated = contactIds[0]).
  contactIds: z.array(uuidSchema).min(1).max(10),
  contactId: uuidSchema.nullable().optional(),
  truckId: uuidSchema.nullable().optional(),
  driverId: uuidSchema.nullable().optional(),
  // PIN re-verified server-side on submit
  pin: z.string().regex(/^\d{4}$/),
});
export type CreateBeneficiaryRequestInput = z.infer<typeof createBeneficiaryRequestSchema>;

/**
 * Authenticated transporter submission. Identical field-shape to the beneficiary
 * portal MINUS `pin` (the logged-in session replaces the daily PIN) PLUS an
 * explicit `beneficiaryId` — the portal carried the beneficiary in its URL slug,
 * but the transporter *picks* one of their assigned beneficiaries in the form.
 * Kept in lock-step with `createBeneficiaryRequestSchema` via `.omit`/`.extend`.
 */
export const createTransporterRequestSchema = createBeneficiaryRequestSchema
  .omit({ pin: true })
  .extend({ beneficiaryId: uuidSchema });
export type CreateTransporterRequestInput = z.infer<typeof createTransporterRequestSchema>;

/**
 * Per-beneficiary "comandă" (transport order) settings — upsert body for
 * PUT /transporter/beneficiaries/:id/order-settings. All fields optional; the
 * server applies defaults (currency EUR, paymentTermDays 30) on first insert.
 */
export const beneficiaryOrderSettingsSchema = z.object({
  transportValue: z.number().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().min(1).max(8).optional(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  baleCount: z.number().int().min(0).max(100_000).nullable().optional(),
  baleDimensions: z.string().max(60).nullable().optional(),
  goodsName: z.string().max(120).nullable().optional(),
  truckDescription: z.string().max(120).nullable().optional(),
  loadingLocality: z.string().max(120).nullable().optional(),
  loadingCountry: z.string().max(60).nullable().optional(),
  obs: z.string().max(500).nullable().optional(),
});
export type BeneficiaryOrderSettingsInput = z.infer<typeof beneficiaryOrderSettingsSchema>;

/** Body for the portal code-verification endpoint. */
export const verifyPortalCodeSchema = z.object({
  code: portalCodeSchema,
});
export type VerifyPortalCodeInput = z.infer<typeof verifyPortalCodeSchema>;

/** Driver's public sign-and-leave submission (base64 PNG/JPEG data URL). */
export const signTripSchema = z.object({
  signature: signatureUrlSchema,
});
export type SignTripInput = z.infer<typeof signTripSchema>;

/** Admin-editable request-portal settings for the caller's own org. */
export const updateOrgRequestSettingsSchema = z.object({
  requestAccessCode: portalCodeSchema.nullable(),
  allowedCropTypes: z.array(cropTypeSchema).max(20),
});
export type UpdateOrgRequestSettingsInput = z.infer<typeof updateOrgRequestSettingsSchema>;

/**
 * Body for confirming a request (admin/dispatcher).
 *
 * The pickup source is EITHER a depot or a field, never both — mirrors the XOR
 * already established for `registerLoadSchema`/`forceStatusSchema` in
 * trip-transition.schema.ts (goods come off a field or out of a depot, never both).
 */
export const confirmTripRequestSchema = z
  .object({
    // Optional override of the internal code for the spawned auxiliary truck.
    internalCode: z.string().min(1).max(40).optional(),
    // Source depot (delivery_destination) the driver picks the goods up from.
    depotId: uuidSchema.optional(),
    // Source field (parcel) the driver picks the goods up from directly.
    parcelId: uuidSchema.optional(),
  })
  .refine((d) => !!d.depotId !== !!d.parcelId, {
    message: 'exactly one of depotId or parcelId is required',
  });
export type ConfirmTripRequestInput = z.infer<typeof confirmTripRequestSchema>;

/** Body for cancelling a request (admin/dispatcher). */
export const cancelTripRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Correcting an aux transport IN PLACE (admin/dispatcher) — PATCH /trip-requests/:id.
 *
 * The operator's ask: "if something was typed wrong I want to fix it, not have
 * to delete the transport and re-create it."
 *
 * PATCH semantics: only the keys PRESENT are written. An explicit `null` clears
 * a nullable column; an absent key leaves it alone. That is why the clearable
 * fields are `.nullable()` rather than `.optional()` before `.partial()` — the
 * two mean different things here, and the service branches on key presence, not
 * on truthiness.
 *
 * The exceptions are deliberate and are exactly the NOT NULL columns:
 * `requesterName`, `requesterPhone`, `truckRegistrationPlate`, `driverName` and
 * `driverPhone`. Sending `null` for one of those is a 400 here rather than a
 * constraint violation surfacing as a 500. Everything else follows the column —
 * `neededDate` included, because `needed_date` IS nullable and the portal
 * already stores requests without one, so refusing to clear it would make the
 * modal offer an edit that can only ever fail.
 *
 * `.strict()` is load-bearing, not style: it turns `status`, `machineId`,
 * `tripId`, `comandaOrderNo`, `beneficiaryId`, `notifyRecipients`, `confirmedBy`
 * and every read-only join field (`tripNumber`, `machinePlate`, `hasAviz`…) into
 * a 400 rather than a key that is silently ignored.
 *
 * Enumerated explicitly, never `createBeneficiaryRequestSchema.partial()`: that
 * schema carries `pin`, `contactIds` and `beneficiaryId`, which are credentials
 * and provenance — not facts a human mistypes. Bounds mirror it field for field.
 *
 * Absent on purpose:
 *   - lifecycle columns (owned by confirm/cancel and by the trip itself);
 *   - `comandaOrderNo` + `beneficiaryId` — the per-beneficiary counter is drawn
 *     ONCE and written back so regeneration is idempotent; repointing either
 *     corrupts it;
 *   - `notifyRecipients` — a snapshot whose fan-out has already fired;
 *   - `destinationCoords` — there is no map picker in the edit modal, so the
 *     service NULLs the REQUEST's point when the destination text changes rather
 *     than keeping a stale pin. It never touches the TRIP's point: that one is a
 *     stock-attribution key (see `depotInboundBales`).
 */
export const updateTripRequestSchema = z
  .object({
    // who is requesting
    requesterName: z.string().min(1).max(120),
    requesterPhone: z.string().min(4).max(40),
    requesterEmail: z.string().email().max(160).nullable(),
    companyName: z.string().min(1).max(160).nullable(),
    companyAddress: z.string().max(300).nullable(),
    companyCui: z.string().max(40).nullable(),
    // their truck — cascaded onto the one-time auxiliary `machines` row
    truckRegistrationPlate: z.string().min(1).max(40),
    truckMake: z.string().max(80).nullable(),
    truckModel: z.string().max(80).nullable(),
    truckCapacityTons: z.number().positive().max(1000).nullable(),
    trailerRegistrationPlate: z.string().max(40).nullable(),
    // transporter company
    transporterName: z.string().max(200).nullable(),
    transporterCui: z.string().max(20).nullable(),
    transporterAddress: z.string().max(300).nullable(),
    // their driver — cascaded onto the live trip's external_driver_* columns
    driverName: z.string().min(1).max(120),
    driverPhone: z.string().min(4).max(40),
    driverEmail: z.string().email().max(160).nullable(),
    // the ask
    cropType: cropTypeSchema.nullable(),
    // Mirrors the CHECK constraint — an invalid grade must be a 400, not a
    // constraint violation surfacing as a 500.
    quality: z.enum(['quality_1', 'quality_2']).nullable(),
    tonsRequested: z.number().positive().max(100000).nullable(),
    neededDate: isoDateSchema.nullable(),
    unloadingDate: isoDateSchema.nullable(),
    destinationAddress: z.string().max(300).nullable(),
    destinationLocality: z.string().max(160).nullable(),
    notes: z.string().max(2000).nullable(),
    // Pickup source — "I picked the wrong depot at confirm". Same XOR the
    // confirm body enforces: goods come off a field or out of a depot, never
    // both. Sending BOTH as non-null is rejected below; sending one clears the
    // other server-side, because the pair must hold in the ROW, not just here.
    sourceDepotId: uuidSchema.nullable(),
    sourceParcelId: uuidSchema.nullable(),
    /**
     * Re-send the transport-confirmation e-mail + driver SMS with the corrected
     * data. OFF by default — the operator decides: a tonnage typo does not
     * deserve an SMS, a wrong driver phone number does.
     */
    resendConfirmation: z.boolean(),
  })
  .partial()
  .strict()
  .refine((d) => !(d.sourceDepotId && d.sourceParcelId), {
    message: 'at most one of sourceDepotId or sourceParcelId may be set',
  })
  .refine((d) => Object.keys(d).some((k) => k !== 'resendConfirmation'), {
    message: 'at least one field must be provided',
  });
export type UpdateTripRequestInput = z.infer<typeof updateTripRequestSchema>;

