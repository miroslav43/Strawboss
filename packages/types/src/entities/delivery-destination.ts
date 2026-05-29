import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';

export interface DeliveryDestination extends Timestamps, SoftDelete {
  id: string;
  code: string;
  name: string;
  address: string;
  coords: GeoPoint | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  boundary: string | null;
  isActive: boolean;
  isDefault: boolean;
  /**
   * Latest activity touching this destination — currently the MAX(updated_at)
   * across non-deleted task_assignments referencing it. Only populated by the
   * list endpoint (`GET /delivery-destinations`); other endpoints leave it
   * undefined.
   */
  lastActivityAt?: string | null;
}
