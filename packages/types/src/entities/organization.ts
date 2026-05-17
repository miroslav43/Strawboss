import type { Timestamps, SoftDelete } from '../common.js';

export interface Organization extends Timestamps, SoftDelete {
  id: string;
  slug: string;
  name: string;
}

export interface CreateOrganizationDto {
  slug: string;
  name: string;
}
