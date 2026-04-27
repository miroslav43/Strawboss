'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from '@strawboss/api';
import { clientLogger } from '@/lib/client-logger';

const MAX_RETRIES = 10;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const subscribe = useCallback(() => {
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, (payload) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
        const recordId =
          (payload.new as { id?: string } | undefined)?.id ??
          (payload.old as { id?: string } | undefined)?.id;
        if (recordId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(recordId) });
        }
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
        if (status === 'SUBSCRIBED') {
          if (retryCountRef.current > 0) {
            clientLogger.info('Supabase Realtime reconnected', {
              channel: 'db-changes',
              retriesUsed: retryCountRef.current,
            });
            queryClient.invalidateQueries();
          }
          retryCountRef.current = 0;
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clientLogger.warn('Supabase Realtime subscription issue', {
            channel: 'db-changes',
            status,
            retryCount: retryCountRef.current,
          });

          supabase.removeChannel(channel);
          channelRef.current = null;

          if (retryCountRef.current >= MAX_RETRIES) {
            console.error(
              `Supabase Realtime: giving up after ${MAX_RETRIES} reconnect attempts`,
            );
            return;
          }

          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current += 1;

          reconnectTimerRef.current = setTimeout(() => {
            channelRef.current = subscribe();
          }, delay);
        }
      });

    channelRef.current = channel;
    return channel;
  }, [queryClient]);

  useEffect(() => {
    channelRef.current = subscribe();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [subscribe]);

  return <>{children}</>;
}
