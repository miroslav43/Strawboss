/**
 * A reusable truck (with its transporter company) saved under a beneficiary,
 * selectable from the public request portal. Bundles the vehicle plates/capacity
 * and the transporter firm identity into one record.
 */
export interface BeneficiaryTruck {
  id: string;
  organizationId: string;
  beneficiaryId: string;
  truckRegistrationPlate: string;
  trailerRegistrationPlate: string | null;
  capacityTons: number | null;
  transporterName: string | null;
  transporterCui: string | null;
  transporterAddress: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateBeneficiaryTruckDto {
  truckRegistrationPlate: string;
  trailerRegistrationPlate?: string | null;
  capacityTons?: number | null;
  transporterName?: string | null;
  transporterCui?: string | null;
  transporterAddress?: string | null;
}

export type UpdateBeneficiaryTruckDto = Partial<CreateBeneficiaryTruckDto>;
