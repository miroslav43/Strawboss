import { z } from 'zod';
import { geoPointSchema } from '../helpers/geo.js';
import { isoDateSchema } from '../helpers/iso-date.js';
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
  // the ask
  cropType: cropTypeSchema,
  neededDate: isoDateSchema,
  tonsRequested: z.number().positive().max(100000).nullable().optional(),
  destinationAddress: z.string().min(1).max(300).nullable().optional(),
  destinationCoords: geoPointSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // PIN re-verified server-side on submit
  pin: z.string().regex(/^\d{4}$/),
});
export type CreateBeneficiaryRequestInput = z.infer<typeof createBeneficiaryRequestSchema>;

/** Body for the portal code-verification endpoint. */
export const verifyPortalCodeSchema = z.object({
  code: portalCodeSchema,
});
export type VerifyPortalCodeInput = z.infer<typeof verifyPortalCodeSchema>;

/** Driver's public sign-and-leave submission (base64 PNG/JPEG data URL). */
export const signTripSchema = z.object({
  signature: z.string().min(1),
});
export type SignTripInput = z.infer<typeof signTripSchema>;

/** Admin-editable request-portal settings for the caller's own org. */
export const updateOrgRequestSettingsSchema = z.object({
  requestAccessCode: portalCodeSchema.nullable(),
  allowedCropTypes: z.array(cropTypeSchema).max(20),
});
export type UpdateOrgRequestSettingsInput = z.infer<typeof updateOrgRequestSettingsSchema>;

/** Body for confirming a request (admin/dispatcher). */
export const confirmTripRequestSchema = z.object({
  // Optional override of the internal code for the spawned auxiliary truck.
  internalCode: z.string().min(1).max(40).optional(),
});

/** Body for cancelling a request (admin/dispatcher). */
export const cancelTripRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
