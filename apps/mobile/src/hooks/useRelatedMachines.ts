import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

export interface RelatedMachine {
  machineId: string;
  machineType: string | null;
  machineCode: string | null;
  operatorName: string | null;
  assignedUserName: string | null;
  lat: number;
  lon: number;
  recordedAt: string;
}

export function useRelatedMachines() {
  const userId = useAuthStore((s) => s.userId);
  return useQuery({
    queryKey: ['related-machines', userId],
    queryFn: () => mobileApiClient.get<RelatedMachine[]>('/api/v1/location/related-machines'),
    enabled: !!userId,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
