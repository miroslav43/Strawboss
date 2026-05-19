import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import type { CreateUserPayload, UpdateUserPayload } from './use-admin-users.js';

/**
 * Super-admin user management — same CRUD as `useAdminUsers` but scoped on
 * an explicit `orgId` from the URL, since super_admin has no session orgId.
 * Backed by `/api/v1/super-admin/organizations/:orgId/users`.
 */

const superAdminUsersKey = (orgId: string) =>
  ['super-admin', 'users', orgId] as const;

/** List operator accounts inside a specific organization. */
export function useSuperAdminUsers(client: ApiClient, orgId: string) {
  return useQuery({
    queryKey: superAdminUsersKey(orgId),
    queryFn: () =>
      client.get<User[]>(`/api/v1/super-admin/organizations/${orgId}/users`),
    enabled: !!orgId,
  });
}

/** Create a user inside a specific organization. */
export function useCreateSuperAdminUser(client: ApiClient, orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      client.post<User>(
        `/api/v1/super-admin/organizations/${orgId}/users`,
        payload,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: superAdminUsersKey(orgId) });
    },
  });
}

/** Update an existing user inside a specific organization. */
export function useUpdateSuperAdminUser(client: ApiClient, orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserPayload }) =>
      client.patch<User>(
        `/api/v1/super-admin/organizations/${orgId}/users/${id}`,
        data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: superAdminUsersKey(orgId) });
    },
  });
}

/** Soft-delete (deactivate) a user inside a specific organization. */
export function useDeactivateSuperAdminUser(client: ApiClient, orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.delete<void>(
        `/api/v1/super-admin/organizations/${orgId}/users/${id}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: superAdminUsersKey(orgId) });
    },
  });
}
