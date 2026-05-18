'use client';

import { createContext, useContext } from 'react';
import { todayInRomania } from '@/lib/date';

interface TasksDateContextType {
  selectedDate: string;
  setSelectedDate: (d: string) => void;
}

export const TasksDateContext = createContext<TasksDateContextType>({
  selectedDate: todayInRomania(),
  setSelectedDate: () => {},
});

export function useTasksDate() {
  return useContext(TasksDateContext);
}
