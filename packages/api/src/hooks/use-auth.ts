import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { queryKeys } from '../queries/query-keys.js';

export function useSession(supabaseClient: SupabaseClient) {
  return useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: async () => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      return data.session;
    },
  });
}

export function useLogin(supabaseClient: SupabaseClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.session() });
    },
  });
}

export function useLogout(supabaseClient: SupabaseClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.session() });
    },
  });
}
