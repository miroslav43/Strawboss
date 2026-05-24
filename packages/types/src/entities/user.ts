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
  /** Plan C — heartbeat timestamp updated by POST /profile/heartbeat (mobile, 30s). */
  lastSeenAt: string | null;
  /** Derived in API layer (`isOnline = lastSeenAt within ONLINE_WINDOW_S`). Not stored. */
  isOnline?: boolean;
  assignedMachineId: string | null;
  /** Present on profile API responses when joined from organizations. */
  organizationId?: string | null;
  organizationSlug?: string | null;
}
