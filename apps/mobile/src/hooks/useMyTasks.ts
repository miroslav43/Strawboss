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
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const today = todayDateString();

  const query = useQuery({
    queryKey: ['my-tasks', today, userId, assignedMachineId],
    queryFn: async () => {
      // #region agent log
      fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'useMyTasks.ts:54',message:'tasks:fetch-start',data:{today,userId},hypothesisId:'D,E,F',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'useMyTasks.ts:72',message:'tasks:fetch-done',data:{today,userId,availableCount:plan.available?.length??0,inProgressGroups:plan.inProgress?.length??0,doneCount:plan.done?.length??0,totalTasks:all.length,assignedUserIds:all.map((t)=>t.assignedUserId),machineCodes:all.map((t)=>t.machineCode)},hypothesisId:'D,E',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // Filter to assignments for this operator:
      //   - explicit user assignments, OR
      //   - tasks whose machine matches the user's currently assigned machine
      //     (admin may set only the machine and rely on the operator mapping).
      const mine = userId
        ? all.filter(
            (t) =>
              t.assignedUserId === userId ||
              (assignedMachineId !== null && t.machineId === assignedMachineId),
          )
        : [];

      // Sort by sequence order
      mine.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

      // #region agent log
      fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'useMyTasks.ts:82',message:'tasks:after-filter',data:{userId,assignedMachineId,mineCount:mine.length,machineIdsSeen:all.map((t)=>t.machineId)},hypothesisId:'E,post-fix',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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
