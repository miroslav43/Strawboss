import '@/lib/register-background-tasks';

import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  Alert,
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
import { registerForPushNotifications, addNotificationListener, addNotificationResponseListener } from '@/lib/notifications';
import { handleIncomingPush } from '@/lib/notification-handler';
import { NotificationsRepo } from '@/db/notifications-repo';
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
import { debugIngest } from '@/lib/debug-ingest';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
    },
  },
});

// Keep splash visible until hideAsync; run at load (Expo recommendation). Native
// keep-awake can reject on some Android devices — swallow so the app still boots.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const ROLE_ROUTES: Record<string, string> = {
  baler_operator: '/(baler)',
  loader_operator: '/(loader)',
  driver: '/(driver)',
};

function LoadingSplash() {
  return (
    <View style={splash.container}>
      <Image
        // React Native requires require() for bundled image assets.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    // #region agent log
    debugIngest(
      'app/_layout.tsx:AuthGate',
      'getSession start',
      {
        hasSupabaseUrl: !!process.env.EXPO_PUBLIC_SUPABASE_URL,
      },
      'H5'
    );
    // #endregion
    supabase.auth
      .getSession()
      .then(({ data }) => {
        // #region agent log
        debugIngest(
          'app/_layout.tsx:AuthGate',
          'getSession ok',
          { hasSession: !!data.session },
          'H5'
        );
        // #endregion
        setIsAuthenticated(!!data.session);
      })
      .catch((err) => {
        // #region agent log
        debugIngest(
          'app/_layout.tsx:AuthGate',
          'getSession catch',
          { err: err instanceof Error ? err.message : String(err) },
          'H5'
        );
        // #endregion
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

    let cancelled = false;
    let profileFetchFailed = false;
    const t0 = Date.now();
    const profileTimeoutMs = 20_000;
    // #region agent log
    debugIngest('app/_layout.tsx:AuthGate', 'profile fetch start', {}, 'L3');
    // #endregion

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (cancelled) return;
      // #region agent log
      debugIngest(
        'app/_layout.tsx:AuthGate',
        'profile fetch watchdog fired',
        { ms: Date.now() - t0 },
        'L3'
      );
      // #endregion
      setProfileReady(true);
    }, profileTimeoutMs);

    const clearWatchdog = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    mobileApiClient
      .get<User>('/api/v1/profile')
      .then((profile) => {
        if (cancelled) return;
        setProfile({
          role: profile.role,
          userId: profile.id,
          assignedMachineId: profile.assignedMachineId ?? null,
        });
        // #region agent log
        debugIngest(
          'app/_layout.tsx:AuthGate',
          'profile fetch ok',
          { ms: Date.now() - t0 },
          'L3'
        );
        // #endregion
      })
      .catch(async (err) => {
        if (cancelled) return;
        profileFetchFailed = true;
        // #region agent log
        debugIngest(
          'app/_layout.tsx:AuthGate',
          'profile fetch error',
          {
            ms: Date.now() - t0,
            err: err instanceof Error ? err.message : String(err),
          },
          'L3'
        );
        // #endregion
        if (__DEV__) console.warn('[StrawBoss] Profile fetch failed', err);
        Alert.alert(
          'Eroare de conectare',
          'Nu s-a putut încărca profilul. Verificați conexiunea și reconectați-vă.',
          [{ text: 'OK' }]
        );
        const supabase = getSupabaseClient();
        await supabase.auth.signOut();
        if (!cancelled) {
          setIsAuthenticated(false);
          setProfileReady(false);
        }
      })
      .finally(() => {
        clearWatchdog();
        if (cancelled || profileFetchFailed) return;
        // #region agent log
        debugIngest(
          'app/_layout.tsx:AuthGate',
          'profile fetch finally',
          { ms: Date.now() - t0 },
          'L3'
        );
        // #endregion
        setProfileReady(true);
      });

    return () => {
      cancelled = true;
      clearWatchdog();
    };
  }, [isAuthenticated, role, setProfile]);

  // Intercept all incoming pushes → persist to local notifications table
  useEffect(() => {
    const fgSub = addNotificationListener((notification) => {
      void handleIncomingPush(notification);
    });
    const tapSub = addNotificationResponseListener((response) => {
      void handleIncomingPush(response.notification);
    });
    return () => {
      fgSub.remove();
      tapSub.remove();
    };
  }, []);

  // 7-day cleanup of local notification history on mount
  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new NotificationsRepo(db);
        await repo.cleanupOlderThan(7 * 24 * 3600 * 1000);
      } catch {
        // Non-critical
      }
    })();
  }, []);

  // Register push token once profile is loaded
  useEffect(() => {
    if (!isAuthenticated || !role) return;
    const { userId, assignedMachineId } = useAuthStore.getState();
    if (!userId) return;

    registerForPushNotifications()
      .then((token) => {
        if (__DEV__) {
          if (token) console.info('[StrawBoss] DEV: push token registered:', token.slice(0, 40) + '...');
          else console.info('[StrawBoss] DEV: no push token — local notifications only (run `npx eas init` to enable push)');
        }
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

  // All authenticated users: register periodic background sync (WorkManager / BGTaskScheduler).
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role) return;
    void registerBackgroundSyncTask();
    return () => {
      void unregisterBackgroundSyncTask();
    };
  }, [isAuthenticated, profileReady, role]);

  // Android only: GPS foreground service for users with an assigned machine.
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role) return;
    if (!assignedMachineId || Platform.OS !== 'android') {
      void stopBackgroundLocationTracking();
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
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, profileReady, role, assignedMachineId]);

  useEffect(() => {
    // #region agent log
    debugIngest(
      'app/_layout.tsx:AuthGate',
      'auth snapshot',
      {
        isAuthenticated,
        profileReady,
        role: role ?? null,
        seg0: segments[0] ?? null,
      },
      'H5'
    );
    // #endregion
  }, [isAuthenticated, profileReady, role, segments]);

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

    // Not in auth group: only redirect when the user is inside the *wrong*
    // role group. Non-group top-level routes (loader-ops, baler-ops,
    // driver-ops, notifications, etc.) must be allowed through — otherwise
    // pushing to e.g. `/loader-ops/load-bales` bounces straight back to the
    // role home.
    const targetSegment = destination.slice(1); // '/(driver)' → '(driver)'
    const current = segments[0] ?? '';
    const isGroupRoute = current.startsWith('(') && current.endsWith(')');
    if (isGroupRoute && current !== targetSegment) {
      router.replace(destination as Parameters<typeof router.replace>[0]);
    }
  }, [isAuthenticated, profileReady, role, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    // #region agent log
    debugIngest(
      'app/_layout.tsx:RootLayout',
      'dbReady changed',
      { dbReady, showing: dbReady ? 'AuthGate' : 'LoadingSplash' },
      'H1'
    );
    // #endregion
  }, [dbReady]);

  useEffect(() => {
    // #region agent log
    debugIngest(
      'app/_layout.tsx:RootLayout',
      'bootstrap useEffect start',
      { __DEV__ },
      'H1'
    );
    // #endregion
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      // #region agent log
      debugIngest(
        'app/_layout.tsx:RootLayout',
        'dbReady timeout 20s fired',
        {},
        'H1'
      );
      // #endregion
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
        // #region agent log
        debugIngest(
          'app/_layout.tsx:RootLayout',
          'getDatabase promise catch',
          { err: err instanceof Error ? err.message : String(err) },
          'H1'
        );
        // #endregion
        if (__DEV__) console.warn('[StrawBoss] getDatabase failed', err);
      })
      .finally(() => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        // #region agent log
        debugIngest(
          'app/_layout.tsx:RootLayout',
          'getDatabase finally → setDbReady',
          {},
          'H1'
        );
        // #endregion
        setDbReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    // #region agent log
    debugIngest(
      'app/_layout.tsx:RootLayout',
      'calling SplashScreen.hideAsync',
      {},
      'H3'
    );
    // #endregion
    void SplashScreen.hideAsync().then(
      () => {
        // #region agent log
        debugIngest(
          'app/_layout.tsx:RootLayout',
          'SplashScreen.hideAsync resolved',
          {},
          'H3'
        );
        // #endregion
      },
      (e) => {
        // #region agent log
        debugIngest(
          'app/_layout.tsx:RootLayout',
          'SplashScreen.hideAsync rejected',
          { err: e instanceof Error ? e.message : String(e) },
          'H3'
        );
        // #endregion
      }
    );
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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="notifications" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          </Stack>
        </AuthGate>
      ) : (
        <LoadingSplash />
      )}
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}
