'use client';

import { useProfile } from '@strawboss/api';
import { UserRole } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * May the signed-in user dispatch — manage trips and trip requests?
 *
 * Mirrors the `@Roles(admin, dispatcher)` guard the backend puts on
 * `GET /trip-requests` and `DELETE /trips/:id`. The backend 403 remains the real
 * security boundary; this only stops the UI offering an action that would fail,
 * or firing a query that would come back 403 for an operator who signed in on
 * the web (login supports username + PIN operator accounts).
 *
 * `isLoading` is returned separately, and callers must respect it. Collapsing it
 * into `isDispatcher === false` would mean an admin hard-reloading the page sees
 * the whole auxiliary ledger MISSING for the duration of the profile fetch —
 * indistinguishable from "there is nothing to confirm today".
 */
export function useIsDispatcher(): { isDispatcher: boolean; isLoading: boolean } {
  const { data: profile, isPending } = useProfile(apiClient);
  const role = profile?.role;
  return {
    isDispatcher: role === UserRole.admin || role === UserRole.dispatcher,
    isLoading: isPending,
  };
}
