import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { getDatabase } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import { mobileApiClient } from '@/lib/api-client';
import type { User } from '@strawboss/types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});

const ROLE_ROUTES: Record<string, string> = {
  baler_operator: '/(baler)',
  loader_operator: '/(loader)',
  driver: '/(driver)',
};

function AuthGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const { role, setProfile } = useAuthStore();

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (!session) {
        useAuthStore.getState().clear();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch profile and store role when authenticated
  useEffect(() => {
    if (!isAuthenticated || role) return;

    mobileApiClient
      .get<User>('/api/v1/profile')
      .then((profile) => {
        setProfile({
          role: profile.role,
          userId: profile.id,
          assignedMachineId: profile.assignedMachineId ?? null,
        });
      })
      .catch(() => {
        // Profile fetch failed — fall through to default route
      });
  }, [isAuthenticated, role, setProfile]);

  useEffect(() => {
    if (isAuthenticated === null) return; // Still loading

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (isAuthenticated && inAuthGroup) {
      // Route based on role if known, otherwise default to (tabs)
      const destination = role ? (ROLE_ROUTES[role] ?? '/(tabs)') : '/(tabs)';
      router.replace(destination as Parameters<typeof router.replace>[0]);
    }
  }, [isAuthenticated, role, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDatabase().then(() => setDbReady(true));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {dbReady ? (
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      ) : null}
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}
