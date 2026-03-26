import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { getDatabase } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthenticated === null) return; // Still loading

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDatabase().then(() => setDbReady(true));
  }, []);

  if (!dbReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}
