'use client';
export const dynamic = 'force-dynamic';

import { MachinePlanBoard } from '@/components/features/tasks/machine-plan/MachinePlanBoard';
import { useTasksDate } from '../tasks-date-context';

export default function LoaderTasksPage() {
  const { selectedDate } = useTasksDate();
  return <MachinePlanBoard date={selectedDate} machineType="loader" color="blue" />;
}
