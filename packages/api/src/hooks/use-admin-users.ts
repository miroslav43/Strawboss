import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, UserRole } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

const ADMIN_USERS_KEY = ['admin', 'users'] as const;

export interface CreateUserPayload {
  fullName: string;
  role: UserRole;
  phone?: string | null;
  /** Optional: admin override for the auto-generated username. */
  usernameOverride?: string;
}

export interface UpdateUserPayload {
  fullName?: string;
  role?: UserRole;
  phone?: string | null;
  isActive?: boolean;
  assignedMachineId?: string | null;
  /** Admin can edit the username (must be unique). */
  username?: string;
  /** Admin can edit the 4-digit PIN (also updates Supabase Auth password). */
  pin?: string;
}

/** List all operator accounts (admin only). */
export function useAdminUsers(client: ApiClient) {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => client.get<User[]>('/api/v1/admin/users'),
  });
}

/** Create a new operator account. */
export function useCreateUser(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      client.post<User>('/api/v1/admin/users', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
  });
}

/** Update an existing user's role, name, or active status. */
export function useUpdateUser(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserPayload }) =>
      client.patch<User>(`/api/v1/admin/users/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
  });
}

/** Soft-delete (deactivate) an operator account. */
export function useDeactivateUser(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/admin/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
  });
}
