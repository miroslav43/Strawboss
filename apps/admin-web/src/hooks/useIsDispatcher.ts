'use client';

import { useProfile } from '@strawboss/api';
import { UserRole } from '@strawboss/types';
import { apiClient } from '@/lib/api';

/**
 * True when the signed-in user may dispatch: manage trips and trip requests.
 *
 * Mirrors the `@Roles(admin, dispatcher)` guard the backend puts on
 * `GET /trip-requests` and `DELETE /trips/:id`. The backend 403 remains the
 * real security boundary — this only stops the UI from offering an action that
 * would fail, or from firing a query that would come back 403 for an operator
 * who signed in on the web (login supports username + PIN operator accounts).
 */
export function useIsDispatcher(): boolean {
  const { data: profile } = useProfile(apiClient);
  const role = profile?.role;
  return role === UserRole.admin || role === UserRole.dispatcher;
}
