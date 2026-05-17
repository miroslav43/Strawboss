'use client';
export const dynamic = 'force-dynamic';

import { MachinePlanBoard } from '@/components/features/tasks/machine-plan/MachinePlanBoard';
import { useTasksDate } from '../tasks-date-context';

export default function BalerTasksPage() {
  const { selectedDate } = useTasksDate();
  return <MachinePlanBoard date={selectedDate} machineType="baler" color="amber" />;
}
