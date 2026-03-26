import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskAssignment } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useTaskAssignments(client: ApiClient, date: string) {
  return useQuery({
    queryKey: queryKeys.taskAssignments.byDate(date),
    queryFn: () => client.get<TaskAssignment[]>(`/api/v1/task-assignments?date=${date}`),
    enabled: !!date,
  });
}

export function useCreateTaskAssignment(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TaskAssignment>) =>
      client.post<TaskAssignment>('/api/v1/task-assignments', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useBulkCreateTaskAssignments(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TaskAssignment>[]) =>
      client.post<TaskAssignment[]>('/api/v1/task-assignments/bulk', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useAssignMachineToParcel(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { machineId: string; parcelId: string; assignmentDate: string; sequenceOrder: number }) =>
      client.post<TaskAssignment>('/api/v1/task-assignments', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}
