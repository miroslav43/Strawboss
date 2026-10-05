'use client';

import { useProfile } from '@strawboss/api';
import { UserRole } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * Is the signed-in user an admin (NOT a dispatcher)?
 *
 * `useIsDispatcher()` is true for admin AND dispatcher, so it cannot gate the
 * opt-in button and the settings panel, which the backend restricts to admin
 * (`PUT /meteo/settings`). The backend 403 stays the real boundary.
 * Same `{ isAdmin, isLoading }` shape as `useIsDispatcher` — respect `isLoading`.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { data: profile, isPending } = useProfile(apiClient);
  return { isAdmin: profile?.role === UserRole.admin, isLoading: isPending };
}
