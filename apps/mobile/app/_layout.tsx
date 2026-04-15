import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { getDatabase } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import { mobileApiClient } from '@/lib/api-client';
import { cleanupOldMobileLogFiles } from '@/lib/logger';
import { registerForPushNotifications } from '@/lib/notifications';
import type { User } from '@strawboss/types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
    },
  },
});

const ROLE_ROUTES: Record<string, string> = {
  baler_operator: '/(baler)',
  loader_operator: '/(loader)',
  driver: '/(driver)',
};

function LoadingSplash() {
  return (
    <View style={splash.container}>
      <Text style={splash.title}>StrawBoss</Text>
      <ActivityIndicator color="#0A5C36" style={{ marginTop: 24 }} />
    </View>
  );
}

const splash = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3DED8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#0A5C36',
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [profileReady, setProfileReady] = useState(false); // true once profile fetch settled
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
        setProfileReady(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch profile once authenticated (and not already loaded)
  useEffect(() => {
    if (!isAuthenticated || role) {
      if (!isAuthenticated) return;
      // role already set from a previous fetch — mark as ready
      setProfileReady(true);
      return;
    }

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
        // Profile fetch failed — proceed to default route
      })
      .finally(() => {
        setProfileReady(true);
      });
  }, [isAuthenticated, role, setProfile]);

  // Register push token once profile is loaded
  useEffect(() => {
    if (!isAuthenticated || !role) return;
    const { userId, assignedMachineId } = useAuthStore.getState();
    if (!userId) return;

    registerForPushNotifications().then((token) => {
      if (token) {
        mobileApiClient
          .post('/api/v1/notifications/register-token', {
            token,
            platform: Platform.OS,
            machineId: assignedMachineId ?? undefined,
          })
          .catch(() => {});
      }
    });
  }, [isAuthenticated, role]);

  useEffect(() => {
    if (isAuthenticated === null) return; // Session check still pending

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated) {
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    // Authenticated — determine correct destination once profile is settled
    if (!profileReady) return; // Wait for profile fetch to complete

    const destination = role
      ? (ROLE_ROUTES[role] ?? '/(tabs)')
      : '/(tabs)';

    if (inAuthGroup) {
      // On login screen — navigate to role-specific route now that profile is ready
      router.replace(destination as Parameters<typeof router.replace>[0]);
      return;
    }

    // Not in auth group: check if we're in the wrong tab group
    const targetSegment = destination.slice(1); // '/(driver)' → '(driver)'
    if (segments[0] !== targetSegment) {
      router.replace(destination as Parameters<typeof router.replace>[0]);
    }
  }, [isAuthenticated, profileReady, role, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDatabase().then(() => setDbReady(true));
  }, []);

  useEffect(() => {
    void cleanupOldMobileLogFiles();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void cleanupOldMobileLogFiles();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {dbReady ? (
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      ) : (
        <LoadingSplash />
      )}
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}
