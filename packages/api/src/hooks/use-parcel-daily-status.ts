import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ParcelDailyStatus } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useParcelDailyStatuses(client: ApiClient, date: string) {
  return useQuery({
    queryKey: queryKeys.parcelDailyStatus.byDate(date),
    queryFn: () => client.get<ParcelDailyStatus[]>(`/api/v1/parcel-daily-status?date=${date}`),
    enabled: !!date,
  });
}

export function useUpsertParcelDailyStatus(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { parcelId: string; statusDate: string; isDone: boolean; notes?: string | null }) =>
      client.put<ParcelDailyStatus>('/api/v1/parcel-daily-status', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcelDailyStatus.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useDeleteParcelDailyStatusForDate(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parcelId, statusDate }: { parcelId: string; statusDate: string }) =>
      client.delete<void>(
        `/api/v1/parcel-daily-status?parcelId=${encodeURIComponent(parcelId)}&date=${encodeURIComponent(statusDate)}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcelDailyStatus.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}
