import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProfileResponse } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useFeaturesStore } from '@/stores/features-store';

/**
 * Fetches the current user's profile and keeps the Zustand auth store in sync.
 * Reusable across all role-based layouts.
 */
export function useProfile() {
  const setProfile = useAuthStore((s) => s.setProfile);
  const setDisabledFeatures = useFeaturesStore((s) => s.setDisabled);

  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<ProfileResponse>('/api/v1/profile'),
  });

  useEffect(() => {
    if (query.data) {
      // Secondary flag channel. `/fleet/checkin` is the one that reaches an
      // idle fielded phone on its own; this covers the moments the profile IS
      // refetched (login, foreground resume) and keeps the two in step.
      if (query.data.features?.disabled) {
        setDisabledFeatures(query.data.features.disabled);
      }
      setProfile({
        role: query.data.role,
        userId: query.data.id,
        assignedMachineId: query.data.assignedMachineId ?? null,
        assignedDeliveryDestinationId: query.data.assignedDeliveryDestinationId ?? null,
        signatureSpecimenUrl: query.data.signatureSpecimenUrl ?? null,
        locale:
          ((query.data as unknown as Record<string, unknown>).locale as string | null) ?? null,
      });
    }
  }, [query.data, setProfile, setDisabledFeatures]);

  return {
    profile: query.data ?? null,
    role: query.data?.role ?? null,
    assignedMachineId: query.data?.assignedMachineId ?? null,
    assignedDeliveryDestinationId: query.data?.assignedDeliveryDestinationId ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
