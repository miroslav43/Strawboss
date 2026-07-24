import { UserRole } from '@strawboss/types';

/**
 * i18n key suffixes for each user role — resolve via `t(ROLE_LABEL_KEYS[role])`.
 * Centralised here so any screen that displays roles (accounts list, reports,
 * super-admin reveals) shows the same localized label.
 */
export const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  [UserRole.super_admin]: 'accounts.role.super_admin',
  [UserRole.admin]: 'accounts.role.admin',
  [UserRole.dispatcher]: 'accounts.role.dispatcher',
  [UserRole.baler_operator]: 'accounts.role.baler_operator',
  [UserRole.loader_operator]: 'accounts.role.loader_operator',
  [UserRole.driver]: 'accounts.role.driver',
  [UserRole.geofence_maker]: 'accounts.role.geofence_maker',
  [UserRole.depot_manager]: 'accounts.role.depot_manager',
  [UserRole.transportator]: 'accounts.role.transportator',
};

/**
 * Lookup label key with a fallback for legacy/unknown role strings that may
 * still exist in old reports payloads.
 */
export function roleLabelKey(role: UserRole | string): string {
  return ROLE_LABEL_KEYS[role as UserRole] ?? 'accounts.role.unknown';
}
