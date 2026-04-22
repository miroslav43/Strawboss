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
  /** Task assignments without a parcel (e.g. trucks planned without a source field). */
  unassignedToParcel?: MyTask[];
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
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const today = todayDateString();

  const query = useQuery({
    queryKey: ['my-tasks', today, userId, assignedMachineId],
    queryFn: async () => {
      const plan = await mobileApiClient.get<DailyPlanResponse>(
        `/api/v1/task-assignments/daily-plan/${today}`,
      );

      const all: MyTask[] = [];
      if (plan.available) all.push(...plan.available);
      if (plan.inProgress) {
        for (const group of plan.inProgress) {
          all.push(...group.assignments);
        }
      }
      if (plan.done) all.push(...plan.done);
      if (plan.unassignedToParcel) all.push(...plan.unassignedToParcel);

      const mine = userId
        ? all.filter(
            (t) =>
              t.assignedUserId === userId ||
              (assignedMachineId !== null && t.machineId === assignedMachineId),
          )
        : [];

      mine.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

      return mine.filter(taskHasRenderableLocation);
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
