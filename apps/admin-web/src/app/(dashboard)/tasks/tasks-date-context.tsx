'use client';

import { createContext, useContext } from 'react';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

interface TasksDateContextType {
  selectedDate: string;
  setSelectedDate: (d: string) => void;
}

export const TasksDateContext = createContext<TasksDateContextType>({
  selectedDate: formatDate(new Date()),
  setSelectedDate: () => {},
});

export function useTasksDate() {
  return useContext(TasksDateContext);
}
