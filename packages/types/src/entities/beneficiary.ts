import type { CropType } from './parcel.js';

export interface Beneficiary {
  id: string;
  organizationId: string;
  slug: string;
  displayName: string;
  companyName: string;
  companyAddress: string | null;
  companyCui: string | null;
  dailyPin: string;
  pinGeneratedAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Returned by the public GET endpoint — PIN is never exposed. */
export interface PublicBeneficiaryInfo {
  displayName: string;
  companyName: string;
  companyAddress: string | null;
  companyCui: string | null;
  organizationName: string;
  allowedCropTypes: CropType[];
}

export interface CreateBeneficiaryDto {
  slug: string;
  displayName: string;
  companyName: string;
  companyAddress?: string | null;
  companyCui?: string | null;
}

export type UpdateBeneficiaryDto = Partial<CreateBeneficiaryDto> & {
  /** Activate / deactivate the beneficiary's public request portal. */
  isActive?: boolean;
};
