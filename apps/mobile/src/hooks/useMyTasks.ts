import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

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

interface DailyPlanResponse {
  date: string;
  available: MyTask[];
  inProgress: { parcelId: string; parcelName: string; assignments: MyTask[] }[];
  done: MyTask[];
}

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fetches today's task assignments for the current user.
 * Uses the daily-plan endpoint which returns JOINed parcel/machine/destination names,
 * then filters client-side by assignedUserId.
 */
export function useMyTasks() {
  const userId = useAuthStore((s) => s.userId);
  const today = todayDateString();

  const query = useQuery({
    queryKey: ['my-tasks', today, userId],
    queryFn: async () => {
      const plan = await mobileApiClient.get<DailyPlanResponse>(
        `/api/v1/task-assignments/daily-plan/${today}`,
      );

      // Collect all assignments from the structured response
      const all: MyTask[] = [];
      if (plan.available) all.push(...plan.available);
      if (plan.inProgress) {
        for (const group of plan.inProgress) {
          all.push(...group.assignments);
        }
      }
      if (plan.done) all.push(...plan.done);

      // Filter to assignments for this user
      const mine = userId
        ? all.filter((t) => t.assignedUserId === userId)
        : [];

      // Sort by sequence order
      mine.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      return mine;
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
