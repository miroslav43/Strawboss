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

export function useDailyPlan(client: ApiClient, date: string) {
  return useQuery({
    queryKey: queryKeys.taskAssignments.dailyPlan(date),
    queryFn: () => client.get<Record<string, unknown>>(`/api/v1/task-assignments/daily-plan/${date}`),
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

export function useUpdateAssignmentStatus(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      client.patch<TaskAssignment>(`/api/v1/task-assignments/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useAutoCompleteAssignments(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (beforeDate: string) =>
      client.post<unknown>('/api/v1/task-assignments/auto-complete', { beforeDate }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useTasksByMachineType(client: ApiClient, date: string, machineType: string) {
  return useQuery({
    queryKey: queryKeys.taskAssignments.byMachineType(date, machineType),
    queryFn: () =>
      client.get<Record<string, unknown>[]>(
        `/api/v1/task-assignments/by-machine-type/${date}/${machineType}`,
      ),
    enabled: !!date && !!machineType,
  });
}

export function useUpdateTaskAssignment(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TaskAssignment> }) =>
      client.patch<TaskAssignment>(`/api/v1/task-assignments/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}

export function useDeleteTaskAssignment(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.delete<unknown>(`/api/v1/task-assignments/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}
