'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Subscribe to Supabase realtime changes on a table and invalidate
 * a specific React Query key when changes occur.
 */
export function useRealtimeSubscription(
  table: string,
  queryKey: readonly unknown[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`realtime-${table}-${JSON.stringify(queryKey)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          void queryClient.invalidateQueries({ queryKey: [...queryKey] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, queryKey, queryClient]);
}
