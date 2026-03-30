import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Fetches the current user's profile and keeps the Zustand auth store in sync.
 * Reusable across all role-based layouts.
 */
export function useProfile() {
  const setProfile = useAuthStore((s) => s.setProfile);

  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  useEffect(() => {
    if (query.data) {
      setProfile({
        role: query.data.role,
        userId: query.data.id,
        assignedMachineId: query.data.assignedMachineId ?? null,
      });
    }
  }, [query.data, setProfile]);

  return {
    profile: query.data ?? null,
    role: query.data?.role ?? null,
    assignedMachineId: query.data?.assignedMachineId ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
