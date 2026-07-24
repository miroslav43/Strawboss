'use client';

import { useProfile } from '@strawboss/api';
import { UserRole } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * Is the signed-in user a `transportator` (external hauler, web-only)?
 *
 * Belt-and-suspenders for the transporter shell: the real boundaries are the
 * layout redirect (client) and the backend `@Roles(transportator)` guard + RLS
 * (server). `isLoading` is returned separately so a page can wait rather than
 * flash the wrong UI during the profile fetch.
 */
export function useIsTransportator(): { isTransportator: boolean; isLoading: boolean } {
  const { data: profile, isPending } = useProfile(apiClient);
  return {
    isTransportator: profile?.role === UserRole.transportator,
    isLoading: isPending,
  };
}
