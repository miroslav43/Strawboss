'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { TaskBoard } from '@/components/features/tasks/TaskBoard';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export default function TasksPage() {
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));

  return (
    <div>
      <PageHeader
        title="Task Board"
        actions={
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-neutral-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        }
      />

      <p className="mb-4 text-xs text-neutral-500">
        Drag machines between columns to assign them to parcels for{' '}
        <span className="font-medium">{selectedDate}</span>.
      </p>

      <TaskBoard date={selectedDate} />
    </div>
  );
}
