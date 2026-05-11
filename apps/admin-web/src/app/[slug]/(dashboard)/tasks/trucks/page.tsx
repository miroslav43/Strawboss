'use client';
export const dynamic = 'force-dynamic';

import { TruckPlanBoard } from '@/components/features/tasks/machine-plan/TruckPlanBoard';
import { useTasksDate } from '../tasks-date-context';

export default function TruckTasksPage() {
  const { selectedDate } = useTasksDate();
  return <TruckPlanBoard date={selectedDate} />;
}
