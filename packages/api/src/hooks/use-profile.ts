import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { User, ProfileResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

const profileKey = ['profile'] as const;

/**
 * MERGE the mutation result into the cached profile instead of replacing it.
 *
 * Every profile mutation resolves to a bare `User` (that is what PATCH returns),
 * while the cache holds a `ProfileResponse` carrying `features`. A plain
 * `setQueryData(profileKey, user)` therefore DROPPED the feature list on any
 * profile edit — switching the UI language would silently re-enable every
 * disabled page in the sidebar until the next refetch, and each of those pages
 * would then 403 on write.
 *
 * The no-cache fallback supplies an empty disabled list, matching the fail-open
 * posture everywhere else: never invent restrictions the server did not send.
 */
const mergeProfile = (qc: QueryClient) => (user: User) => {
  qc.setQueryData<ProfileResponse>(profileKey, (prev) =>
    prev ? { ...prev, ...user } : { ...user, features: { disabled: [] } },
  );
};

/** Fetch the current authenticated user's profile (including assignedMachineId). */
export function useProfile(client: ApiClient) {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => client.get<ProfileResponse>('/api/v1/profile'),
  });
}

/** Persist UI locale (en | ro) on the user row for cross-device sync. */
export function useUpdateProfileLocale(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: 'en' | 'ro') => client.patch<User>('/api/v1/profile', { locale }),
    onSuccess: mergeProfile(qc),
  });
}

/** Update profile fields: fullName, phone, locale, notificationPrefs, avatarUrl, signatureSpecimenUrl. */
export function useUpdateProfile(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: {
      fullName?: string;
      phone?: string | null;
      locale?: 'en' | 'ro';
      notificationPrefs?: Record<string, boolean>;
      avatarUrl?: string | null;
      signatureSpecimenUrl?: string | null;
    }) => client.patch<User>('/api/v1/profile', dto),
    onSuccess: mergeProfile(qc),
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
    mutationFn: (formData: FormData) => client.upload<User>('/api/v1/profile/avatar', formData),
    onSuccess: (user) => {
      mergeProfile(qc)(user);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

/**
 * Upload the current user's signature specimen. Expects a `FormData` with a
 * single `file` field (PNG/JPEG/WebP). The server writes a canonical
 * `uploads/specimens/{userId}.png` and returns the updated user.
 */
export function useUploadSpecimen(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => client.upload<User>('/api/v1/profile/specimen', formData),
    onSuccess: (user) => {
      mergeProfile(qc)(user);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
