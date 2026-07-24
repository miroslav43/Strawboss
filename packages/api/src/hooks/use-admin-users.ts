import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, UserRole } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

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
  assignedDeliveryDestinationId?: string | null;
  /** Admin can edit the username (must be unique). */
  username?: string;
  /** Admin can edit the 4-digit PIN (also updates Supabase Auth password). */
  pin?: string;
  /** UI locale preference for this user. */
  locale?: 'en' | 'ro';
}

export interface UseAdminUsersOptions {
  /** Re-fetch interval in ms. Pages that display the presence dot pass 30_000. */
  refetchInterval?: number;
}

/** List all operator accounts (admin only). */
export function useAdminUsers(client: ApiClient, options?: UseAdminUsersOptions) {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => client.get<User[]>('/api/v1/admin/users'),
    refetchInterval: options?.refetchInterval,
  });
}

/** Create a new operator account. */
export function useCreateUser(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) => client.post<User>('/api/v1/admin/users', payload),
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

/**
 * Admin-only: the beneficiary ids a transporter account is assigned to. Enabled
 * only for a real userId (the modal passes '' when closed).
 */
export function useTransporterAssignments(client: ApiClient, userId: string) {
  return useQuery({
    queryKey: queryKeys.transporterAssignments.byUser(userId),
    queryFn: () => client.get<string[]>(`/api/v1/admin/users/${userId}/beneficiaries`),
    enabled: !!userId,
  });
}

/** Admin-only: replace a transporter account's beneficiary assignments (set-replace). */
export function useSetTransporterAssignments(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, beneficiaryIds }: { id: string; beneficiaryIds: string[] }) =>
      client.put<{ ok: true }>(`/api/v1/admin/users/${id}/beneficiaries`, { beneficiaryIds }),
    onSuccess: (_r, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.transporterAssignments.byUser(id) });
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
  });
}

/**
 * Admin-only: upload a profile picture for another user. Used by the admin
 * Accounts edit modal. Expects a `FormData` with a single `file` field.
 */
export function useUploadUserAvatar(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      client.upload<User>(`/api/v1/admin/users/${id}/avatar`, formData),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
