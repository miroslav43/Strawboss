import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { todayInRomania } from '@/lib/date';

export interface MyTask {
  id: string;
  assignmentDate: string;
  machineId: string;
  parcelId: string | null;
  assignedUserId: string | null;
  priority: string;
  sequenceOrder: number;
  status: string;
  parentAssignmentId: string | null;
  destinationId: string | null;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  notes: string | null;
  machineCode: string;
  machineType: string;
  registrationPlate: string | null;
  parcelName: string | null;
  parcelCode: string | null;
  assignedUserName: string | null;
  destinationName: string | null;
  destinationCode: string | null;
}

/** Drop placeholder / admin-empty rows with no field or destination to show or open on the map. */
function taskHasRenderableLocation(t: MyTask): boolean {
  const parcelOk =
    (t.parcelId != null && t.parcelId !== '') ||
    (t.parcelName != null && String(t.parcelName).trim() !== '') ||
    (t.parcelCode != null && String(t.parcelCode).trim() !== '');
  const destOk =
    (t.destinationId != null && t.destinationId !== '') ||
    (t.destinationName != null && String(t.destinationName).trim() !== '') ||
    (t.destinationCode != null && String(t.destinationCode).trim() !== '');
  return parcelOk || destOk;
}

/**
 * M40: Fetches today's task assignments for the current user via the
 * server-side filtered endpoint `GET /api/v1/task-assignments/my-tasks?date=YYYY-MM-DD`.
 *
 * This replaces the previous implementation that fetched the full daily plan
 * and filtered client-side by `assignedUserId`.  The new endpoint returns only
 * the assignments belonging to the authenticated user, reducing payload size.
 *
 * Return shape is identical to the previous implementation so all existing
 * consumers of `useMyTasks` continue to work without changes.
 */
export function useMyTasks() {
  const userId = useAuthStore((s) => s.userId);
  const today = todayInRomania();

  const query = useQuery({
    queryKey: ['my-tasks', today, userId],
    queryFn: async () => {
      const tasks = await mobileApiClient.get<MyTask[]>(
        `/api/v1/task-assignments/my-tasks?date=${today}`,
      );

      const sorted = [...tasks].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      return sorted.filter(taskHasRenderableLocation);
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
