/**
 * Configurare urmărire permanentă (o singură dată per telefon).
 *
 * Pe Android nu putem acorda programatic permisiunea de locație în fundal,
 * scutirea de la optimizarea bateriei sau pornirea automată (autostart) OEM —
 * doar îl ghidăm pe utilizator către ecranele potrivite. Acești trei pași fac
 * diferența între o aplicație care e oprită de sistem și una mereu activă.
 *
 * Starea „configurat" e persistată în SecureStore. Afișat după login pentru
 * rolurile cu mașină (vezi `app/_layout.tsx`) și reaccesibil din profil.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  AppState,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { colors } from '@strawboss/ui-tokens';
import { useAuthStore } from '@/stores/auth-store';
import { mobileLogger } from '@/lib/logger';
import { requestBackgroundLocationPermissions } from '@/lib/location';
import {
  isBatteryOptimizationActive,
  requestBatteryOptimizationExemption,
  openOemAutostartSettings,
  hasOemAutostartScreen,
  openFullScreenIntentSettings,
} from '@/lib/oem-helpers';
import { isDeviceOwner, canUseFullScreenIntent } from '@/lib/device-owner';

type MCIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Persisted flag ────────────────────────────────────────────────────────────

export const TRACKING_SETUP_KEY = 'hasCompletedTrackingSetup';

export async function markTrackingSetupSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(TRACKING_SETUP_KEY, '1');
  } catch (err) {
    mobileLogger.warn('tracking-setup: failed to mark seen', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function hasSeenTrackingSetup(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(TRACKING_SETUP_KEY)) === '1';
  } catch {
    return false;
  }
}

// ── Role home mapping (mirrors _layout) ───────────────────────────────────────

function roleHome(role: string | null): string {
  switch (role) {
    case 'baler_operator':
      return '/(baler)';
    case 'loader_operator':
      return '/(loader)';
    case 'driver':
      return '/(driver)';
    case 'geofence_maker':
      return '/(geofence-maker)';
    case 'depot_manager':
      return '/(deposit)';
    default:
      return '/(tabs)';
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TrackingSetupScreen() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);

  const [bgGranted, setBgGranted] = useState(false);
  const [batteryExempt, setBatteryExempt] = useState(false);
  const [fsiGranted, setFsiGranted] = useState(false);
  const showAutostart = hasOemAutostartScreen();
  // Full-screen-intent grant only matters on Android 14+ (auto-granted below).
  const showFsi = Platform.OS === 'android' && (Platform.Version as number) >= 34;
  const stepCount = 2 + (showAutostart ? 1 : 0) + (showFsi ? 1 : 0);

  const refreshStatus = useCallback(async () => {
    try {
      const bg = await Location.getBackgroundPermissionsAsync();
      setBgGranted(bg.status === Location.PermissionStatus.GRANTED);
    } catch {
      /* ignore */
    }
    // isBatteryOptimizationActive === true means NOT exempt yet.
    const active = await isBatteryOptimizationActive();
    setBatteryExempt(!active);
    try {
      setFsiGranted(await canUseFullScreenIntent());
    } catch {
      /* ignore */
    }
  }, []);

  // Refresh on mount and whenever the user returns from a system settings screen.
  useEffect(() => {
    void refreshStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => sub.remove();
  }, [refreshStatus]);

  const onGrantLocation = useCallback(async () => {
    await requestBackgroundLocationPermissions();
    await refreshStatus();
  }, [refreshStatus]);

  const onBattery = useCallback(async () => {
    await requestBatteryOptimizationExemption();
    // status refresh happens on AppState 'active' when the user returns
  }, []);

  const onAutostart = useCallback(async () => {
    await openOemAutostartSettings();
  }, []);

  const onFsi = useCallback(async () => {
    await openFullScreenIntentSettings();
    // status refresh happens on AppState 'active' when the user returns
  }, []);

  const finish = useCallback(async () => {
    await markTrackingSetupSeen();
    mobileLogger.flow('tracking-setup: completed', {
      role: role ?? 'unknown',
      bgGranted,
      batteryExempt,
    });
    router.replace(roleHome(role) as Parameters<typeof router.replace>[0]);
  }, [role, router, bgGranted, batteryExempt]);

  // Non-Android: nothing to configure — bounce straight to role home. Runs once
  // on mount (finish is stable enough; intentionally not re-run on its identity).
  useEffect(() => {
    if (Platform.OS !== 'android') {
      void finish();
    }
  }, [finish]);

  // Device-owner phones auto-grant location/battery/notifications/full-screen —
  // there is nothing for the user to do, so skip the walkthrough entirely.
  useEffect(() => {
    void (async () => {
      if (await isDeviceOwner()) {
        await markTrackingSetupSeen();
        void finish();
      }
    })();
  }, [finish]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="map-marker-check" size={64} color={colors.primary} />
          <Text style={styles.title}>Urmărire permanentă</Text>
          <Text style={styles.subtitle}>
            Pentru ca poziția să fie transmisă mereu — chiar cu ecranul stins sau aplicația în
            fundal — activează cei {stepCount} pași de mai jos. Se fac o singură dată pe acest
            telefon.
          </Text>
        </View>

        <SetupStep
          icon="crosshairs-gps"
          title="Locație „Permite mereu”"
          body="Acordă permisiunea de locație în fundal (alege „Permite tot timpul / Allow all the time”)."
          done={bgGranted}
          actionLabel={bgGranted ? 'Acordat' : 'Acordă'}
          onPress={onGrantLocation}
        />

        <SetupStep
          icon="battery-heart-variant"
          title="Fără optimizarea bateriei"
          body="Scoate aplicația din optimizarea bateriei, ca sistemul să nu o oprească în fundal."
          done={batteryExempt}
          actionLabel={batteryExempt ? 'Scutit' : 'Dezactivează'}
          onPress={onBattery}
        />

        {showAutostart && (
          <SetupStep
            icon="restart"
            title="Pornire automată (autostart)"
            body="Activează „Autostart / Pornire automată” pentru StrawBoss în setările producătorului, ca să repornească după restart."
            done={false}
            actionLabel="Deschide"
            onPress={onAutostart}
          />
        )}

        {showFsi && (
          <SetupStep
            icon="bell-ring"
            title="Alerte ecran complet"
            body="Permite afișarea alertelor peste ecranul blocat, ca să vezi imediat intrarea/ieșirea din câmp."
            done={fsiGranted}
            actionLabel={fsiGranted ? 'Acordat' : 'Deschide'}
            onPress={onFsi}
          />
        )}

        <TouchableOpacity
          style={styles.finishBtn}
          onPress={() => void finish()}
          activeOpacity={0.85}
        >
          <Text style={styles.finishBtnText}>Gata, continuă</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={colors.white} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SetupStep({
  icon,
  title,
  body,
  done,
  actionLabel,
  onPress,
}: {
  icon: string;
  title: string;
  body: string;
  done: boolean;
  actionLabel: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, done && styles.stepIconDone]}>
        <MaterialCommunityIcons
          name={(done ? 'check-bold' : icon) as MCIconName}
          size={28}
          color={done ? colors.white : colors.primary}
        />
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        <Text style={styles.stepText}>{body}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, done && styles.stepBtnDone]}
          onPress={() => void onPress()}
          activeOpacity={0.85}
        >
          <Text style={[styles.stepBtnText, done && styles.stepBtnTextDone]}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '700', color: colors.primary, marginTop: 12 },
  subtitle: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 10,
  },
  step: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    gap: 14,
  },
  stepIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(10,92,54,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconDone: { backgroundColor: colors.primary },
  stepBody: { flex: 1 },
  stepTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  stepText: { fontSize: 14, color: '#4B5563', lineHeight: 20, marginTop: 4, marginBottom: 12 },
  stepBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  stepBtnDone: { backgroundColor: 'rgba(10,92,54,0.12)' },
  stepBtnText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  stepBtnTextDone: { color: colors.primary },
  finishBtn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  finishBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
