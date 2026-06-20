import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';
import type { CropType } from './parcel.js';

export enum RequestStatus {
  pending = 'pending',
  confirmed = 'confirmed',
  cancelled = 'cancelled',
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
  neededDate: string | null;
  tonsRequested: number | null;
  destinationAddress: string | null;
  destinationLocality: string | null;
  destinationCoords: GeoPoint | null;
  notes: string | null;
  // linkage, filled on confirm
  machineId: string | null;
  tripId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
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
  truckMake?: string | null;
  truckModel?: string | null;
  truckCapacityTons?: number | null;
  driverName: string;
  driverPhone: string;
  driverEmail?: string | null;
  cropType?: CropType | null;
  neededDate?: string | null;
  tonsRequested?: number | null;
  destinationAddress?: string | null;
  destinationLocality?: string | null;
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
