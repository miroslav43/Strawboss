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
   * Depot kind. `temporary` (provizoriu) depots take only a bale count at
   * delivery; `principal` (fix) depots also take gross/tare weights (net is
   * computed) unless the operator flags a broken scale.
   */
  depotType: 'principal' | 'temporary';
  /**
   * Geofence radius (metres) inside which a depot operator may confirm an
   * arriving truck's delivery. Server-enforced against the truck's latest GPS.
   */
  confirmRadiusM: number;
  /**
   * Latest activity touching this destination — currently the MAX(updated_at)
   * across non-deleted task_assignments referencing it. Only populated by the
   * list endpoint (`GET /delivery-destinations`); other endpoints leave it
   * undefined.
   */
  lastActivityAt?: string | null;
  /**
   * Current bales in the depot — all-time delivered (bales never leave the
   * model). Only populated by the list endpoint; matches the Reports → Depozite
   * figure. Undefined on other endpoints.
   */
  currentBaleStock?: number | null;
}
