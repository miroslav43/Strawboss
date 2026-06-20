import type { Timestamps, SoftDelete } from '../common.js';
import type { CropType } from './parcel.js';

export interface Organization extends Timestamps, SoftDelete {
  id: string;
  slug: string;
  name: string;
  /** 4-digit code gating the public request portal (/<slug>/request). Null until set. */
  requestAccessCode: string | null;
  /** Subset of CropType the request portal offers; empty = portal not configured. */
  allowedCropTypes: CropType[];
}

export interface CreateOrganizationDto {
  slug: string;
  name: string;
}

/** Admin-editable request-portal settings for the caller's own organization. */
export interface OrgRequestSettings {
  requestAccessCode: string | null;
  allowedCropTypes: CropType[];
}
