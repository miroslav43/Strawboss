import '@/lib/register-background-tasks';

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
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:AuthGate-mount',message:'[H4] AuthGate mounted, about to call supabase.auth.getSession()',data:{},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const supabase = getSupabaseClient();
    supabase.auth.getSession()
      .then(({ data }) => {
        // #region agent log
        fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:getSession-resolved',message:'[H4] supabase.auth.getSession() resolved',data:{hasSession:!!data.session},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setIsAuthenticated(!!data.session);
      })
      .catch((err) => {
        // #region agent log
        fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:getSession-rejected',message:'[H4] supabase.auth.getSession() REJECTED — isAuthenticated stays null forever',data:{error:String((err as Error)?.message ?? err)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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

  // #region agent log
  fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:RootLayout-render',message:'[H2/H3] RootLayout function body executing (JS bundle reached React tree)',data:{dbReady},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  useEffect(() => {
    getDatabase()
      .then(() => {
        // #region agent log
        fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:getDatabase-resolved',message:'[H3] getDatabase() resolved OK — dbReady becoming true',data:{},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setDbReady(true);
      })
      .catch((err) => {
        // #region agent log
        fetch('http://127.0.0.1:7683/ingest/3d71bb49-f968-4f69-8e84-89a66bd466af',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abba4'},body:JSON.stringify({sessionId:'3abba4',location:'_layout.tsx:getDatabase-rejected',message:'[H3] getDatabase() REJECTED — splash will hang',data:{error:String((err as Error)?.message ?? err)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      });
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
