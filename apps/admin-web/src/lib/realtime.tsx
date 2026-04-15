'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from '@strawboss/api';
import { clientLogger } from '@/lib/client-logger';

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parcel_daily_status' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.parcelDailyStatus.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_destinations' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryDestinations.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'geofence_events' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clientLogger.warn('Supabase Realtime subscription issue', {
            channel: 'db-changes',
            status,
          });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return <>{children}</>;
}
