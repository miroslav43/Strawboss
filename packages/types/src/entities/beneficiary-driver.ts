/**
 * A reusable driver saved under a beneficiary, selectable from the public
 * request portal so the requester doesn't re-type it every time.
 */
export interface BeneficiaryDriver {
  id: string;
  organizationId: string;
  beneficiaryId: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateBeneficiaryDriverDto {
  name: string;
  phone: string;
  email?: string | null;
}

export type UpdateBeneficiaryDriverDto = Partial<CreateBeneficiaryDriverDto>;
