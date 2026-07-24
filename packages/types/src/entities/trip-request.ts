import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';
import type { CropType } from './parcel.js';
import type { TripStatus } from './trip.js';

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
  // Comandă (transport order): the unloading/delivery date typed on the
  // transporter form; loading date is neededDate. NULL for the public portals.
  unloadingDate: string | null;
  // The order number assigned to this request's comandă (per-beneficiary counter),
  // set once at first generation so regeneration is idempotent.
  comandaOrderNo: number | null;
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
  // Provenance: the logged-in transporter (UserRole.transportator) who submitted
  // this request through the authenticated form. NULL for the public portals
  // (4-digit-code and beneficiary-PIN). Backs the transporter's "my trips" ledger,
  // which is filtered to `created_by_user_id = <the transporter's own id>`.
  createdByUserId: string | null;
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
  // resolved names for the ids above (joined from delivery_destinations / users)
  sourceDepotName?: string | null;
  confirmedByName?: string | null;
  /** Full name of the transporter who created this request (joined from users). */
  createdByName?: string | null;

  // ── Live-trip read model ───────────────────────────────────────────────────
  // Populated ONLY by list()/findById(), from a LEFT JOIN LATERAL on
  // `trips.trip_request_id` (the stable direction — `tripId` above is a
  // last-write-wins pointer that is never cleared when a trip is soft-deleted).
  // All absent until a dispatcher materializes the trip on the truck board, so a
  // confirmed-but-unplanned request legitimately has none of them.
  /** Id of the live (non-deleted) trip, if one exists. */
  tripLiveId?: string | null;
  tripNumber?: string | null;
  tripStatus?: TripStatus | null;
  tripBaleCount?: number | null;
  tripLoadingCompletedAt?: string | null;
  tripCompletedAt?: string | null;
  /** When the external driver signed via the one-time public link. */
  tripSignedAt?: string | null;
  tripSourceParcelName?: string | null;
  tripSourceDepotName?: string | null;
  /** Number of live trips on this request. >1 is an anomaly worth surfacing. */
  tripCount?: number;
  // whether a non-deleted aviz (delivery_note document) exists for this request
  hasAviz?: boolean;
  // whether a non-deleted scanned paper CMR (cmr_scan document) exists for this
  // request — uploaded by the loader after an aux load, or overridden by an admin
  hasCmrScan?: boolean;
  // whether a generated comandă (transport-order) document exists for this request
  hasComanda?: boolean;
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
