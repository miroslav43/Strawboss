import '@/lib/register-background-tasks';

import { useEffect, useRef, useState } from 'react';
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
  TouchableOpacity,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { getDatabase, clearLocalData } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import { mobileApiClient } from '@/lib/api-client';
import { cleanupOldMobileLogFiles } from '@/lib/logger';
import {
  registerForPushNotifications,
  addNotificationListener,
  addNotificationResponseListener,
} from '@/lib/notifications';
import { handleIncomingPush } from '@/lib/notification-handler';
import { NotificationsRepo } from '@/db/notifications-repo';
import {
  flushPendingLocationReports,
  postCurrentLocationNow,
  requestBackgroundLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from '@/lib/location';
import { registerBackgroundSyncTask, unregisterBackgroundSyncTask } from '@/lib/background-sync';
import type { User } from '@strawboss/types';

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
  geofence_maker: '/(geofence-maker)',
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

function DbErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={splash.container}>
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../assets/splash-inline.png')}
        style={splash.logo}
        accessible={false}
      />
      <Text style={splash.title}>StrawBoss</Text>
      <Text style={splash.errorMessage}>Baza de date nu a putut fi inițializată.</Text>
      <TouchableOpacity style={splash.retryButton} onPress={onRetry} activeOpacity={0.8}>
        <Text style={splash.retryButtonText}>Reîncearcă</Text>
      </TouchableOpacity>
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
  errorMessage: {
    marginTop: 24,
    fontSize: 16,
    color: '#C62828',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#0A5C36',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [profileReady, setProfileReady] = useState(false); // true once profile fetch settled
  const { role, setProfile } = useAuthStore();
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const activeUserIdRef = useRef<string | null>(null);
  const { modalProps, showModal, hideModal } = useModal();

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) {
          if (activeUserIdRef.current && activeUserIdRef.current !== data.session.user.id) {
            void clearLocalData().catch(() => {});
            queryClient.clear();
            useAuthStore.getState().clear();
            setProfileReady(false);
          }
          activeUserIdRef.current = data.session.user.id;
        }
        setIsAuthenticated(!!data.session);
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[StrawBoss] getSession failed, sending user to login', err);
        }
        setIsAuthenticated(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        void clearLocalData().catch(() => {});
        queryClient.clear();
        useAuthStore.getState().clear();
        activeUserIdRef.current = null;
        setProfileReady(false);
        setIsAuthenticated(false);
        return;
      }
      // Different user logged in without an explicit logout — purge previous data
      if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
        void clearLocalData().catch(() => {});
        queryClient.clear();
        useAuthStore.getState().clear();
        setProfileReady(false);
      }
      activeUserIdRef.current = session.user.id;
      setIsAuthenticated(true);
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

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (cancelled) return;
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
        if (__DEV__) console.info('[StrawBoss] Profile fetch ok', { ms: Date.now() - t0 });
      })
      .catch(async (err) => {
        if (cancelled) return;
        profileFetchFailed = true;
        if (__DEV__) console.warn('[StrawBoss] Profile fetch failed', err);
        showModal({
          type: 'error',
          title: 'Eroare de conectare',
          message: 'Nu s-a putut încărca profilul. Verificați conexiunea și reconectați-vă.',
          onConfirm: hideModal,
        });
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
          if (token)
            console.info('[StrawBoss] DEV: push token registered:', token.slice(0, 40) + '...');
          else
            console.info(
              '[StrawBoss] DEV: no push token — local notifications only (run `npx eas init` to enable push)',
            );
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
    if (isAuthenticated === null) return; // Session check still pending

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated) {
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    // Authenticated — determine correct destination once profile is settled
    if (!profileReady) return; // Wait for profile fetch to complete

    const destination = role ? (ROLE_ROUTES[role] ?? '/(tabs)') : '/(tabs)';

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

  return (
    <>
      {children}
      <AppModal {...modalProps} />
    </>
  );
}

type DbState = 'loading' | 'ready' | 'error';

export default function RootLayout() {
  const [dbState, setDbState] = useState<DbState>('loading');
  // incrementing this key triggers a retry attempt
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setDbState('loading');
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      if (__DEV__) {
        console.warn('[StrawBoss] getDatabase exceeded 20s — unblocking UI');
      }
      // On timeout we do NOT mark as ready — force the error screen so the
      // user can retry explicitly.
      setDbState('error');
    }, 20_000);

    getDatabase()
      .then(() => {
        if (cancelled) return;
        if (__DEV__) console.info('[StrawBoss] getDatabase OK');
        clearTimeout(timeoutId);
        setDbState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (__DEV__) console.warn('[StrawBoss] getDatabase failed', err);
        clearTimeout(timeoutId);
        setDbState('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [retryCount]);

  useEffect(() => {
    if (dbState !== 'ready') return;
    void SplashScreen.hideAsync().catch(() => {});
  }, [dbState]);

  useEffect(() => {
    void cleanupOldMobileLogFiles();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void cleanupOldMobileLogFiles();
        const { userId, assignedMachineId } = useAuthStore.getState();
        if (userId && assignedMachineId) {
          void (async () => {
            await flushPendingLocationReports();
            await postCurrentLocationNow(assignedMachineId);
          })();
        }
      }
    });
    return () => sub.remove();
  }, []);

  if (dbState === 'error') {
    return <DbErrorScreen onRetry={() => setRetryCount((n) => n + 1)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {dbState === 'ready' ? (
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name="notifications"
              options={{ presentation: 'card', animation: 'slide_from_right' }}
            />
          </Stack>
        </AuthGate>
      ) : (
        <LoadingSplash />
      )}
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}
