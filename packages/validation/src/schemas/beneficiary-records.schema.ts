import { z } from 'zod';

/**
 * Schemas for the per-beneficiary reusable records managed from the public
 * request portal: contacts, trucks (+transporter), drivers.
 *
 * Phone is required for contacts and drivers because the request-submission
 * schema (`createBeneficiaryRequestSchema`) requires `requesterPhone` /
 * `driverPhone` (min 4) — enforcing it at save time prevents a confusing
 * submit-time 400 when a phoneless record is selected.
 *
 * The PIN is appended by the controller via `.extend({ pin: portalPinSchema })`
 * (it travels in the request body, never the URL — see public-portal.controller).
 */

/** 4-digit daily portal PIN, re-verified server-side on every call. */
export const portalPinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

// ── Contact ──────────────────────────────────────────────────────────────────
export const createBeneficiaryContactSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(4).max(40),
  email: z.string().email().max(160).nullable().optional(),
});
export type CreateBeneficiaryContactInput = z.infer<typeof createBeneficiaryContactSchema>;

export const updateBeneficiaryContactSchema = createBeneficiaryContactSchema.partial();
export type UpdateBeneficiaryContactInput = z.infer<typeof updateBeneficiaryContactSchema>;

// ── Truck (+ transporter company) ────────────────────────────────────────────
export const createBeneficiaryTruckSchema = z.object({
  truckRegistrationPlate: z.string().min(1).max(40),
  trailerRegistrationPlate: z.string().max(40).nullable().optional(),
  capacityTons: z.number().positive().max(1000).nullable().optional(),
  transporterName: z.string().max(200).nullable().optional(),
  transporterCui: z.string().max(20).nullable().optional(),
  transporterAddress: z.string().max(300).nullable().optional(),
});
export type CreateBeneficiaryTruckInput = z.infer<typeof createBeneficiaryTruckSchema>;

export const updateBeneficiaryTruckSchema = createBeneficiaryTruckSchema.partial();
export type UpdateBeneficiaryTruckInput = z.infer<typeof updateBeneficiaryTruckSchema>;

// ── Driver ───────────────────────────────────────────────────────────────────
export const createBeneficiaryDriverSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(4).max(40),
  email: z.string().email().max(160).nullable().optional(),
});
export type CreateBeneficiaryDriverInput = z.infer<typeof createBeneficiaryDriverSchema>;

export const updateBeneficiaryDriverSchema = createBeneficiaryDriverSchema.partial();
export type UpdateBeneficiaryDriverInput = z.infer<typeof updateBeneficiaryDriverSchema>;
