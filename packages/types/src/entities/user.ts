import type { Timestamps, SoftDelete } from '../common.js';

export enum UserRole {
  super_admin = 'super_admin',
  admin = 'admin',
  dispatcher = 'dispatcher',
  baler_operator = 'baler_operator',
  loader_operator = 'loader_operator',
  driver = 'driver',
  geofence_maker = 'geofence_maker',
  depot_manager = 'depot_manager',
  /**
   * External hauler with a WEB-only account. No mobile app, no machine, no depot.
   * Submits auxiliary-transport requests through an authenticated copy of the
   * beneficiary portal (scoped to admin-assigned beneficiaries) and watches their
   * status read-only. See `TransporterBeneficiary` for the assignment link.
   */
  transportator = 'transportator',
}

export interface User extends Timestamps, SoftDelete {
  id: string;
  email: string;
  username: string | null;
  pin: string | null;
  phone: string | null;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  locale: string;
  avatarUrl: string | null;
  signatureSpecimenUrl: string | null;
  lastLoginAt: string | null;
  /** Plan C — heartbeat timestamp updated by POST /profile/heartbeat (mobile, ~60s). */
  lastSeenAt: string | null;
  /**
   * Computed CLIENT-SIDE by the presence dots (`serverNow() - lastSeenAt <
   * USER_ONLINE_WINDOW_MS`, see @strawboss/types presence SSOT). Not stored and
   * not derived by the API — this field is effectively unused by the server.
   */
  isOnline?: boolean;
  assignedMachineId: string | null;
  assignedDeliveryDestinationId: string | null;
  /** Present on profile API responses when joined from organizations. */
  organizationId?: string | null;
  organizationSlug?: string | null;
}
