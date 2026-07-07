import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';
import type { CropType } from './parcel.js';

export enum RequestStatus {
  pending = 'pending',
  confirmed = 'confirmed',
  cancelled = 'cancelled',
}

/**
 * A single confirmation recipient (denormalized snapshot of a selected saved
 * beneficiary contact). On confirmation the transport-confirmation email + SMS
 * fan out to every entry that has an email / phone.
 */
export interface NotifyRecipient {
  name: string;
  phone: string | null;
  email: string | null;
}

/**
 * An external pickup request submitted through the per-org public portal
 * (/<slug>/request). On confirmation it spins up a one-time auxiliary truck
 * (machineId) and, once assigned, an auxiliary trip (tripId).
 */
export interface TripRequest extends Timestamps, SoftDelete {
  id: string;
  organizationId: string;
  status: RequestStatus;
  // who is requesting
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyCui: string | null;
  // their truck
  truckRegistrationPlate: string;
  truckMake: string | null;
  truckModel: string | null;
  truckCapacityTons: number | null;
  // their driver (no app account)
  driverName: string;
  driverPhone: string;
  driverEmail: string | null;
  // the ask
  cropType: CropType | null;
  // beneficiary portal: quality grade requested (quality_1 | quality_2), replaces cropType
  quality: string | null;
  neededDate: string | null;
  tonsRequested: number | null;
  destinationAddress: string | null;
  destinationLocality: string | null;
  destinationCoords: GeoPoint | null;
  notes: string | null;
  // transporter fields (beneficiary portal)
  beneficiaryId: string | null;
  trailerRegistrationPlate: string | null;
  transporterCui: string | null;
  transporterName: string | null;
  transporterAddress: string | null;
  // traceability: which saved beneficiary records this request was built from
  contactId: string | null;
  truckId: string | null;
  driverId: string | null;
  // Denormalized snapshot of ALL selected contacts (beneficiary portal), used to
  // fan out the transport-confirmation email + SMS on confirm. First entry =
  // primary (mirrors requesterName/Phone/Email). Empty for legacy requests and
  // the non-beneficiary public portal.
  notifyRecipients: NotifyRecipient[];
  // pickup source depot chosen by the dispatcher on confirm
  sourceDepotId: string | null;
  // linkage, filled on confirm
  machineId: string | null;
  tripId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  // read-only enrichment, populated by list()/findById() (joined from machines/trips)
  machineMake?: string | null;
  machineModel?: string | null;
  machinePlate?: string | null;
  tripNumber?: string | null;
  // resolved names for the ids above (joined from delivery_destinations / users)
  sourceDepotName?: string | null;
  confirmedByName?: string | null;
  // whether a non-deleted aviz (delivery_note document) exists for this request
  hasAviz?: boolean;
}

/** Public submission payload (no auth). The portal code is validated separately. */
export interface CreateTripRequestDto {
  requesterName: string;
  requesterPhone: string;
  requesterEmail?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  companyCui?: string | null;
  truckRegistrationPlate: string;
  truckModel?: string | null;
  truckCapacityTons?: number | null;
  driverName: string;
  driverPhone: string;
  driverEmail?: string | null;
  cropType?: CropType | null;
  neededDate?: string | null;
  tonsRequested?: number | null;
  destinationAddress?: string | null;
  destinationCoords?: GeoPoint | null;
  notes?: string | null;
}

/** Public portal metadata returned after a successful code verification. */
export interface PortalInfo {
  organizationName: string;
  allowedCropTypes: CropType[];
}

/** Minimal load summary shown to the driver on the public sign page. */
export interface PublicSignInfo {
  organizationName: string;
  cropType: CropType | null;
  baleCount: number;
  sourceParcelName: string | null;
  sourceParcelMunicipality: string | null;
  alreadySigned: boolean;
}
