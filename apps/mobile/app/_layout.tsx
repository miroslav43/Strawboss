import '@/lib/register-background-tasks';

import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useKeepAwake } from 'expo-keep-awake';
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
import { getSupabaseClient, startAuthAutoRefresh, stopAuthAutoRefresh } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import { mobileApiClient } from '@/lib/api-client';
import { cleanupOldMobileLogFiles } from '@/lib/logger';
import {
  registerForPushNotifications,
  addNotificationListener,
  addNotificationResponseListener,
} from '@/lib/notifications';
import { handleIncomingPush } from '@/lib/notification-handler';
import { runDeviceCheckin } from '@/lib/device-checkin';
import { NotificationsRepo } from '@/db/notifications-repo';
import {
  flushPendingLocationReports,
  postCurrentLocationNow,
  requestBackgroundLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from '@/lib/location';
import { checkMachineInactivity } from '@/lib/inactivity-alarm';
import { ensureTrackingArmed } from '@/lib/tracking-watchdog';
import {
  isDeviceOwner,
  isDeviceOwnerResolved,
  applyDeviceOwnerPolicies,
  startPresenceService,
  stopPresenceService,
} from '@/lib/device-owner';
import { registerBackgroundSyncTask, unregisterBackgroundSyncTask } from '@/lib/background-sync';
import { startHeartbeat, stopHeartbeat } from '@/lib/heartbeat';
import { hasSeenOnboarding } from './onboarding';
import { hasSeenTrackingSetup } from './tracking-setup';
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
  depot_manager: '/(deposit)',
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
  const [profileRetry, setProfileRetry] = useState(0); // bumped to retry a failed profile fetch
  // Track whether the Zustand persist middleware has finished reading from
  // SecureStore. Until hydration is complete, `role` may be null even for a
  // returning user, so we must not fire a profile fetch prematurely.
  const [storeHydrated, setStoreHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const { role, setProfile } = useAuthStore();
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const signatureSpecimenUrl = useAuthStore((s) => s.signatureSpecimenUrl);
  const activeUserIdRef = useRef<string | null>(null);
  // FM-17: tracks whether the onboarding check has been performed for the
  // current session so we fire it at most once per login.
  const onboardingCheckedRef = useRef(false);
  // Always-on tracking setup: shown once per login for Android machine users.
  const trackingSetupCheckedRef = useRef(false);
  const { modalProps, showModal, hideModal } = useModal();

  // Subscribe to hydration completion once (runs at most once per mount).
  useEffect(() => {
    if (storeHydrated) return;
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setStoreHydrated(true);
    });
    // Re-check synchronously in case hydration completed between the useState
    // initializer and this effect running.
    if (useAuthStore.persist.hasHydrated()) {
      setStoreHydrated(true);
    }
    return unsub;
  }, [storeHydrated]);

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
        onboardingCheckedRef.current = false;
        trackingSetupCheckedRef.current = false;
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

  // Fetch profile once authenticated (and not already loaded).
  // We also wait for the Zustand persist store to finish hydrating so that a
  // persisted `role` from a previous session is available before we decide
  // whether to hit the network — this is what makes offline cold-boot work.
  useEffect(() => {
    if (!isAuthenticated || !storeHydrated) return;

    if (role) {
      // role already set — either from hydrated persist storage (offline boot)
      // or from a prior fetch in the same session; mark as ready immediately.
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
          assignedDeliveryDestinationId: profile.assignedDeliveryDestinationId ?? null,
          signatureSpecimenUrl: profile.signatureSpecimenUrl ?? null,
        });
        if (__DEV__) console.info('[StrawBoss] Profile fetch ok', { ms: Date.now() - t0 });
      })
      .catch(async (err) => {
        if (cancelled) return;
        profileFetchFailed = true;
        if (__DEV__) console.warn('[StrawBoss] Profile fetch failed', err);
        // Do NOT sign out: a transient network error at shift start must not
        // wipe the session. Keep the operator signed in and offer a retry; the
        // session persists until they explicitly log out.
        showModal({
          type: 'error',
          title: 'Eroare de conectare',
          message: 'Nu s-a putut încărca profilul. Verificați conexiunea și încercați din nou.',
          onConfirm: () => {
            hideModal();
            setProfileRetry((n) => n + 1);
          },
        });
        if (!cancelled) {
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
  }, [isAuthenticated, storeHydrated, role, setProfile, profileRetry]);

  // Device Owner: re-assert all device-owner policies idempotently on every
  // launch (the admin receiver's onEnabled does NOT re-fire after an APK/OS
  // update). No-op on non-device-owner installs / iOS / Expo Go.
  useEffect(() => {
    void (async () => {
      if (await isDeviceOwner()) {
        await applyDeviceOwnerPolicies();
      }
    })();
  }, []);

  // Intercept all incoming pushes → persist to local notifications table.
  // Also branch on `ota_checkin` push type to trigger an immediate check-in
  // (best-effort acceleration — the periodic poll is the reliable trigger).
  useEffect(() => {
    const fgSub = addNotificationListener((notification) => {
      const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
      if (data?.type === 'ota_checkin') {
        void runDeviceCheckin();
      }
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

  // Fleet check-in — UNCONDITIONAL (runs before and independently of auth).
  // Fires on mount and every 60 s so the server always has fresh telemetry and
  // can push OTA deployments even before an operator logs in. Mirrors the
  // heartbeat pattern (startHeartbeat / stopHeartbeat) but is not paused on
  // background because it piggybacks on the device-owner foreground service.
  useEffect(() => {
    void runDeviceCheckin();
    const checkinTimer = setInterval(() => {
      void runDeviceCheckin();
    }, 60_000);
    return () => {
      clearInterval(checkinTimer);
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

  // Plan C — presence heartbeat (T4). Pings /profile/heartbeat every 30 s so
  // the admin board can render a green dot next to active operators.
  // On device-owner builds it keeps running while backgrounded (a foreground
  // service holds the JS thread); elsewhere the AppState listener pauses it.
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role) return;
    startHeartbeat();
    return () => {
      stopHeartbeat();
    };
  }, [isAuthenticated, profileReady, role]);

  // Device-owner only, Android: start a keep-alive foreground service so the OS
  // doesn't freeze the JS thread when backgrounded — the heartbeat and fleet
  // checkin then keep running with the screen off.
  // Machine roles also have the GPS FGS, but on aggressive OEM ROMs (Honor/EMUI)
  // even that can be killed; the PresenceService acts as belt-and-suspenders.
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role || Platform.OS !== 'android') return;
    let cancelled = false;
    void (async () => {
      const owner = await isDeviceOwner();
      if (cancelled) return;
      if (owner) {
        await startPresenceService();
      } else {
        await stopPresenceService();
      }
    })();
    return () => {
      cancelled = true;
      void stopPresenceService();
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

  // Always-on tracking setup walkthrough: once per login, for Android users with
  // an assigned machine, after they have landed on their role home. Deep-links to
  // background-location / battery / OEM-autostart screens that can't be granted
  // programmatically. Pushed (not replaced) so its "finish" returns to the home.
  useEffect(() => {
    if (!isAuthenticated || !profileReady || !role) return;
    if (Platform.OS !== 'android' || !assignedMachineId) return;
    if (trackingSetupCheckedRef.current) return;
    const cur = segments[0] ?? '';
    const settledOnHome = cur.startsWith('(') && cur.endsWith(')') && cur !== '(auth)';
    if (!settledOnHome) return; // wait until past the login → role-home redirect
    trackingSetupCheckedRef.current = true;
    void (async () => {
      try {
        // Device-owner phones auto-grant everything (location/battery/notif) — the
        // walkthrough has nothing to do, so skip it entirely.
        const owner = await isDeviceOwner();
        const seen = await hasSeenTrackingSetup();
        if (!owner && !seen) {
          router.push('/tracking-setup' as Parameters<typeof router.push>[0]);
        }
      } catch {
        // Non-fatal: a SecureStore failure must never block usage.
      }
    })();
  }, [isAuthenticated, profileReady, role, assignedMachineId, segments, router]);

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

    // Specimen gate: roles that sign on trips (driver, loader_operator) must
    // capture a signature specimen once before reaching their role home. This
    // runs before the onboarding tutorial so the specimen is the very first
    // post-login step. Other roles fall through unchanged.
    const needsSpecimen =
      role === 'driver' || role === 'loader_operator' ? !signatureSpecimenUrl : false;
    if (needsSpecimen && segments[0] !== 'specimen-capture') {
      router.replace('/specimen-capture' as Parameters<typeof router.replace>[0]);
      return;
    }

    if (inAuthGroup) {
      // FM-17: check onboarding once per login, before navigating to the role home.
      // We do this asynchronously and fall through to the role home on any error
      // so a SecureStore failure never blocks boot.
      if (role && !onboardingCheckedRef.current) {
        onboardingCheckedRef.current = true;
        void (async () => {
          try {
            const seen = await hasSeenOnboarding(role);
            if (!seen) {
              router.replace('/onboarding' as Parameters<typeof router.replace>[0]);
              return;
            }
          } catch {
            // Non-fatal: fall through to normal role home navigation
          }
          router.replace(destination as Parameters<typeof router.replace>[0]);
        })();
        return;
      }
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
  }, [isAuthenticated, profileReady, role, signatureSpecimenUrl, segments, router]);

  return (
    <>
      {children}
      <AppModal {...modalProps} />
    </>
  );
}

type DbState = 'loading' | 'ready' | 'error';

export default function RootLayout() {
  // Keep the screen on for the whole app while it is in the foreground — the
  // OS never auto-dims/locks it on its own. Distinct tag so it coexists with
  // the per-screen keep-awake in (baler)/production.tsx. No effect while
  // backgrounded (the screen turns off normally then).
  useKeepAwake('strawboss-screen');

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
    // Prime the memoized device-owner flag so the background branch below can
    // read it synchronously.
    void isDeviceOwner();
    // Start Supabase's token auto-refresh ticker. supabase-js does NOT start it
    // automatically on RN; without it the access token expires (~1 h) and every
    // authenticated request 401s once the screen has been off long enough,
    // freezing last_seen_at (driver drops offline after ~1 h).
    startAuthAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      // Plan C — pause heartbeat in background to save battery. On device-owner
      // builds a foreground service (location or presence) keeps the JS thread
      // alive, so we keep pinging — and refreshing the token — to stay "online"
      // with the screen off. Non-device-owner installs pause both for battery.
      if (state === 'background') {
        if (!isDeviceOwnerResolved()) {
          stopHeartbeat();
          stopAuthAutoRefresh();
        }
      }
      if (state === 'active') {
        startAuthAutoRefresh();
        void cleanupOldMobileLogFiles();
        const { userId, assignedMachineId, role: currentRole } = useAuthStore.getState();
        if (currentRole && userId) {
          startHeartbeat();
          // Pick up admin-side changes (role, depot assignment, signature url)
          // that may have happened while the app was backgrounded.
          void queryClient.invalidateQueries({ queryKey: ['profile'] });
        }
        if (userId && assignedMachineId) {
          void (async () => {
            // Foreground recovery: re-arm tracking first (a backgrounded
            // WorkManager worker may have been refused the location FGS start).
            await ensureTrackingArmed();
            await flushPendingLocationReports();
            await postCurrentLocationNow(assignedMachineId);
            // FM-16: check inactivity after the location flush so the
            // last-success timestamp is as fresh as possible before comparing.
            await checkMachineInactivity(assignedMachineId);
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
            {/* FM-17: onboarding shown once per role after first login */}
            <Stack.Screen
              name="onboarding"
              options={{ presentation: 'card', animation: 'fade', gestureEnabled: false }}
            />
            {/* Signature specimen capture — forced gate for driver/loader_operator at first login */}
            <Stack.Screen
              name="specimen-capture"
              options={{ presentation: 'card', animation: 'fade', gestureEnabled: false }}
            />
            {/* FM-14: daily PDF report — accessible from ProfileScreen */}
            <Stack.Screen
              name="daily-report"
              options={{ presentation: 'card', animation: 'slide_from_right' }}
            />
            {/* Always-on tracking setup — shown once per login for Android machine users */}
            <Stack.Screen
              name="tracking-setup"
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
