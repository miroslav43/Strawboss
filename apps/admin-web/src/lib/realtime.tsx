'use client';
import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from '@strawboss/api';
import { clientLogger } from '@/lib/client-logger';

const MAX_RETRIES = 10;

export type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected';

interface RealtimeContextValue {
  realtimeStatus: RealtimeStatus;
  reconnect: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  realtimeStatus: 'connected',
  reconnect: () => undefined,
});

export function useRealtimeStatus() {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connected');

  const subscribe = useCallback(() => {
    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, (payload) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
        // A trip change also mutates the AUX read model: the Curse Aux rows join
        // their live trip server-side, so a status change there must refresh the
        // request list too, not just the trips list.
        queryClient.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
        const recordId =
          (payload.new as { id?: string } | undefined)?.id ??
          (payload.old as { id?: string } | undefined)?.id;
        if (recordId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(recordId) });
        }
      })
      // trip_requests was never in this channel. Now that the merged Curse page
      // is the ONLY place a new portal request surfaces, the amber intake card
      // must appear without a refresh.
      //
      // Fail-safe by design: if trip_requests turns out not to be in the
      // supabase_realtime publication, this handler is simply an inert no-op —
      // the list still self-heals on window focus (60s staleTime +
      // refetchOnWindowFocus) and every mutation already invalidates on success.
      // So it cannot make anything worse.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_requests' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
          const recordId =
            (payload.new as { id?: string } | undefined)?.id ??
            (payload.old as { id?: string } | undefined)?.id;
          if (recordId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.tripRequests.detail(recordId) });
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parcel_daily_status' },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.parcelDailyStatus.all });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_destinations' },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.deliveryDestinations.all });
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'geofence_events' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
      })
      // FW-5: invalidate machine location cache so map stays live
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_locations' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.location.machines() });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, (payload) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.machines.all });
        const recordId =
          (payload.new as { id?: string } | undefined)?.id ??
          (payload.old as { id?: string } | undefined)?.id;
        if (recordId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.machines.detail(recordId) });
        }
      })
      // Fuel tab sync: a mobile refuel (synced via /sync/push) or another
      // admin session's add/edit/delete must show up live on both the
      // machine-detail fuel card and the global fuel-logs page — `.all` is
      // the ['fuelLogs'] prefix, so it invalidates every filtered variant.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fuel_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.fuelLogs.all });
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
          setRealtimeStatus('connected');
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
            clientLogger.error(
              `Supabase Realtime: giving up after ${MAX_RETRIES} reconnect attempts`,
            );
            setRealtimeStatus('disconnected');
            return;
          }

          setRealtimeStatus('reconnecting');
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

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    retryCountRef.current = 0;
    setRealtimeStatus('reconnecting');
    channelRef.current = subscribe();
  }, [subscribe]);

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

  return (
    <RealtimeContext.Provider value={{ realtimeStatus, reconnect }}>
      {children}
    </RealtimeContext.Provider>
  );
}
