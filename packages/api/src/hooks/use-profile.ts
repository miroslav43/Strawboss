import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

const profileKey = ['profile'] as const;

/** Fetch the current authenticated user's profile (including assignedMachineId). */
export function useProfile(client: ApiClient) {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => client.get<User>('/api/v1/profile'),
  });
}

/** Persist UI locale (en | ro) on the user row for cross-device sync. */
export function useUpdateProfileLocale(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: 'en' | 'ro') =>
      client.patch<User>('/api/v1/profile', { locale }),
    onSuccess: (user) => {
      qc.setQueryData(profileKey, user);
    },
  });
}

/** Update profile fields: fullName, phone, locale, notificationPrefs, avatarUrl. */
export function useUpdateProfile(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: {
      fullName?: string;
      phone?: string | null;
      locale?: 'en' | 'ro';
      notificationPrefs?: Record<string, boolean>;
      avatarUrl?: string | null;
    }) => client.patch<User>('/api/v1/profile', dto),
    onSuccess: (user) => {
      qc.setQueryData(profileKey, user);
    },
  });
}

/** Change user password. */
export function useChangePassword(client: ApiClient) {
  return useMutation({
    mutationFn: (dto: { currentPassword: string; newPassword: string }) =>
      client.post<{ ok: boolean }>('/api/v1/profile/change-password', dto),
  });
}

/**
 * Upload the current user's profile picture. Expects a `FormData` with a
 * single `file` field (mobile: RN-style `{ uri, name, type }`; web: a `File`).
 * Server re-encodes to WebP 512×512 and returns the updated user.
 */
export function useUploadAvatar(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      client.upload<User>('/api/v1/profile/avatar', formData),
    onSuccess: (user) => {
      qc.setQueryData(profileKey, user);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
