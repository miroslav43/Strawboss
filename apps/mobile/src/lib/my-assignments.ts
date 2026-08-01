import type { LocalTaskAssignment } from '@/db/task-assignments-repo';

/**
 * Whether a locally-cached `task_assignments` row belongs to the given
 * operator "today".
 *
 * Mirrors the ownership check the backend's `getMyTasks` query performs
 * server-side (`task-assignments.service.ts`:
 * `assigned_user_id = me OR machine_id IN (SELECT assigned_machine_id FROM
 * users WHERE id = me)`). Most operators are linked through their MACHINE
 * (`users.assigned_machine_id`), not through `assigned_user_id` directly —
 * filtering on `assigned_user_id` alone would show nothing for them.
 *
 * Kept in one place so the offline "my tasks today" fallback (`useMyTasks`)
 * and the offline "my parcels today" set (`useMyAssignedParcelIds`) cannot
 * drift into two different answers to the same question.
 */
export function isMyAssignment(
  a: Pick<LocalTaskAssignment, 'assigned_user_id' | 'machine_id'>,
  ctx: { userId: string | null; machineId: string | null },
): boolean {
  return (
    (ctx.machineId != null && a.machine_id === ctx.machineId) ||
    (ctx.userId != null && a.assigned_user_id === ctx.userId)
  );
}
