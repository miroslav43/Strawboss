import type { LocalTaskAssignment } from '@/db/task-assignments-repo';

/**
 * The one answer to "does this assignment belong to me?", in the shape both
 * callers can reach: the local `task_assignments` row (snake_case, nullable
 * columns) and the server's `MyTask` (camelCase, `machineId: string`).
 *
 * Mirrors the ownership check the backend's `getMyTasks` query performs
 * server-side (`task-assignments.service.ts`:
 * `assigned_user_id = me OR machine_id IN (SELECT assigned_machine_id FROM
 * users WHERE id = me)`). Most operators are linked through their MACHINE
 * (`users.assigned_machine_id`), not through `assigned_user_id` directly —
 * filtering on `assigned_user_id` alone would show nothing for them. But the
 * converse is just as real: production currently has operators with
 * `assigned_machine_id IS NULL`, reachable ONLY through `assigned_user_id`.
 * Filtering on the machine alone leaves them with an empty task list and a
 * screen that says they have no field today.
 *
 * Empty string counts as "no machine". `readTasksFromSqlite` (`useMyTasks`)
 * coalesces a null `machine_id` to `''` because `MyTask.machineId` is
 * non-nullable, so a bare `===` between two absent machines would otherwise
 * report a match and hand every machine-less task to every machine-less
 * operator.
 */
export function isMineByOwner(
  a: { assignedUserId: string | null; machineId: string | null },
  ctx: { userId: string | null; machineId: string | null },
): boolean {
  const byMachine = ctx.machineId != null && ctx.machineId !== '' && a.machineId === ctx.machineId;
  const byUser = ctx.userId != null && ctx.userId !== '' && a.assignedUserId === ctx.userId;
  return byMachine || byUser;
}

/**
 * {@link isMineByOwner} over a locally-cached `task_assignments` row.
 *
 * Kept as the snake_case adapter so the offline "my tasks today" fallback
 * (`useMyTasks`), the offline "my parcels today" set (`useMyAssignedParcelIds`)
 * and the active-field resolver (`useCurrentLoaderParcel`) cannot drift into
 * three different answers to the same question.
 */
export function isMyAssignment(
  a: Pick<LocalTaskAssignment, 'assigned_user_id' | 'machine_id'>,
  ctx: { userId: string | null; machineId: string | null },
): boolean {
  return isMineByOwner({ assignedUserId: a.assigned_user_id, machineId: a.machine_id }, ctx);
}
