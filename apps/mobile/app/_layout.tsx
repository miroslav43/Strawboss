import '@/lib/register-background-tasks';

import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  AppState,
  Platform,
  View,
  Text,
  Image,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { getDatabase } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import { mobileApiClient } from '@/lib/api-client';
import { cleanupOldMobileLogFiles } from '@/lib/logger';
import { registerForPushNotifications } from '@/lib/notifications';
import {
  requestBackgroundLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from '@/lib/location';
import {
  registerBackgroundSyncTask,
  unregisterBackgroundSyncTask,
} from '@/lib/background-sync';
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
      <Image
        source={require('../assets/splash-inline.png')}
        style={splash.logo}
        accessible={false}
      />
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
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
    resizeMode: 'contain',
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
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession()
      .then(({ data }) => {
        setIsAuthenticated(!!data.session);
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[StrawBoss] getSession failed, sending user to login', err);
        }
        setIsAuthenticated(false);
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

    registerForPushNotifications()
      .then((token) => {
        if (token) {
          mobileApiClient
            .post('/api/v1/notifications/register-token', {
              token,
              platform: Platform.OS,
              machineId: assignedMachineId ?? undefined,
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [isAuthenticated, role]);

  // Stop background work when logged out
  useEffect(() => {
    if (isAuthenticated !== false) return;
    void (async () => {
      await stopBackgroundLocationTracking();
      await unregisterBackgroundSyncTask();
    })();
  }, [isAuthenticated]);

  // Android: after login + assigned machine, request location (fg+bg) and start FGS + periodic sync
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role) return;

    if (!assignedMachineId || Platform.OS !== 'android') {
      void stopBackgroundLocationTracking();
      void unregisterBackgroundSyncTask();
      return;
    }

    let cancelled = false;
    void (async () => {
      const ok = await requestBackgroundLocationPermissions();
      if (cancelled || !ok) return;
      try {
        await startBackgroundLocationTracking(assignedMachineId);
      } catch {
        /* Expo Go / denied FGS — best effort */
      }
      if (cancelled) return;
      await registerBackgroundSyncTask();
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, profileReady, role, assignedMachineId]);

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
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      if (__DEV__) {
        console.warn('[StrawBoss] getDatabase exceeded 20s — unblocking UI');
      }
      setDbReady(true);
    }, 20_000);

    getDatabase()
      .then(() => {
        if (__DEV__) console.warn('[StrawBoss] getDatabase OK');
      })
      .catch((err) => {
        if (__DEV__) console.warn('[StrawBoss] getDatabase failed', err);
      })
      .finally(() => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setDbReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    void SplashScreen.preventAutoHideAsync();
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    void SplashScreen.hideAsync();
  }, [dbReady]);

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
