import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Alert,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User, Machine } from '@strawboss/types';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';
import { mobileApiClient } from '@/lib/api-client';
import { getSupabaseClient } from '@/lib/auth';
import { clearLocalData } from '@/lib/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useDevModeStore } from '@/stores/dev-mode-store';
import { OperatorStats } from '@/components/features/stats/OperatorStats';
import { AvatarPicker } from '@/components/shared/AvatarPicker';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';
import { useTapSequence } from '@/hooks/useTapSequence';

const ROLE_LABEL: Record<string, string> = {
  driver:          'Șofer',
  loader_operator: 'Operator Încărcător',
  baler_operator:  'Operator Balotieră',
  dispatcher:      'Dispecer',
  admin:           'Administrator',
};

type MachineIconName = 'wrench' | 'grain' | 'truck' | 'map-marker';
const MACHINE_MDI: Record<string, MachineIconName> = {
  loader: 'wrench',
  baler:  'grain',
  truck:  'truck',
};

export function ProfileScreen() {
  const { clear } = useAuthStore();
  const { devSyncVisible, revealSync, hideSync } = useDevModeStore();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { isConnected } = useNetworkStatus();
  const {
    pendingCount: queueCount,
    failedQueueCount,
    syncing,
    lastSyncAt,
    triggerSync,
    retryFailedAndSync,
    clearFailedQueue,
  } = useSync();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  const assignedMachineId = profile?.assignedMachineId ?? null;
  const { data: machine, isLoading: machineLoading } = useQuery({
    queryKey: ['machine', assignedMachineId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${assignedMachineId}`),
    enabled: !!assignedMachineId,
  });

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    await clearLocalData();
    queryClient.clear();
    clear();
    // Session-only debug toggles reset on logout so the next signed-in user
    // starts from the same baseline as a fresh install.
    hideSync();
  };

  const handleAvatarUploaded = useCallback(
    (user: User) => {
      // Swap the cached profile immediately so the header renders the new
      // picture without a follow-up /profile GET.
      queryClient.setQueryData(['profile'], user);
    },
    [queryClient],
  );

  // Reveal the Sincronizare card after 5 rapid taps on the role badge. The
  // 2.5 s window is lenient enough for thumb-tap precision but short enough
  // that accidental double-taps can't stack into 5 over a minute of idle use.
  const { onTap: onRoleBadgeTap } = useTapSequence({
    count: 5,
    windowMs: 2500,
    onThreshold: () => {
      if (devSyncVisible) return;
      Vibration.vibrate(30);
      revealSync();
      Alert.alert(
        'Sincronizare activată',
        'Controlul de sincronizare va fi vizibil până la închiderea aplicației.',
      );
    },
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['machine'] }),
      triggerSync(),
    ]);
    setRefreshing(false);
  }, [queryClient, triggerSync]);

  const isLoading = profileLoading || (!!assignedMachineId && machineLoading);
  // Every operator role benefits from seeing today's personal totals on the
  // profile (baler, loader, driver alike). Admins still get the rest of the
  // screen without these counters since they don't register usage.
  const OPERATOR_ROLES = new Set(['baler_operator', 'loader_operator', 'driver']);
  const showStats = !!profile?.id && OPERATOR_ROLES.has(profile.role);

  const handleClearFailedQueue = useCallback(() => {
    Alert.alert(
      'Șterge coada eșuată',
      'Înregistrările eșuate vor fi șterse definitiv de pe telefon. Cele deja trimise pe server rămân neschimbate. Continui?',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              const deleted = await clearFailedQueue();
              Alert.alert(
                'Gata',
                deleted > 0
                  ? `S-au șters ${deleted} înregistrări din coadă.`
                  : 'Nu existau înregistrări eșuate.',
              );
            } catch (err) {
              Alert.alert(
                'Eroare',
                err instanceof Error ? err.message : 'Nu s-a putut șterge coada.',
              );
            }
          },
        },
      ],
    );
  }, [clearFailedQueue]);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          {isLoading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : profile ? (
            <>
              <AvatarPicker
                avatarUrl={profile.avatarUrl}
                fullName={profile.fullName}
                onUploaded={handleAvatarUploaded}
              />
              <Text style={styles.fullName}>{profile.fullName}</Text>
              <Text style={styles.email}>{profile.email}</Text>
              <Pressable
                onPress={onRoleBadgeTap}
                style={styles.roleBadge}
                accessibilityLabel={ROLE_LABEL[profile.role] ?? profile.role}
              >
                <Text style={styles.roleText}>
                  {ROLE_LABEL[profile.role] ?? profile.role}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.errorText}>Nu s-au putut încărca datele profilului</Text>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {devSyncVisible ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sincronizare</Text>
            <View style={styles.syncRow}>
              <Text style={styles.syncLabel}>Rețea</Text>
              <Text style={styles.syncValue}>{isConnected ? 'Online' : 'Offline'}</Text>
            </View>
            <View style={styles.syncRow}>
              <Text style={styles.syncLabel}>În coadă</Text>
              <Text
                style={[
                  styles.syncValue,
                  queueCount > 0 ? styles.syncValueHighlight : null,
                ]}
              >
                {queueCount}
              </Text>
            </View>
            {failedQueueCount > 0 ? (
              <Text style={styles.syncFailedHint}>
                Ultimul sync a eșuat pentru {failedQueueCount}{' '}
                {failedQueueCount === 1 ? 'înregistrare' : 'înregistrări'} — folosește butonul de mai
                jos.
              </Text>
            ) : null}
            <View style={styles.syncRow}>
              <Text style={styles.syncLabel}>Ultima sincronizare</Text>
              <Text style={styles.syncValue}>
                {lastSyncAt ? new Date(lastSyncAt).toLocaleString('ro-RO') : '—'}
              </Text>
            </View>
            {syncing ? (
              <Text style={styles.syncHint}>Se sincronizează…</Text>
            ) : null}
            <TouchableOpacity
              style={styles.syncButton}
              onPress={() => void triggerSync()}
              disabled={!isConnected || syncing}
              activeOpacity={0.85}
            >
              <Text style={styles.syncButtonText}>Sincronizează acum</Text>
            </TouchableOpacity>
            {failedQueueCount > 0 ? (
              <>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => void retryFailedAndSync()}
                  disabled={!isConnected || syncing}
                  activeOpacity={0.85}
                >
                  <Text style={styles.retryButtonText}>Reîncearcă înregistrările eșuate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.clearQueueButton}
                  onPress={handleClearFailedQueue}
                  disabled={syncing}
                  activeOpacity={0.85}
                >
                  <Text style={styles.clearQueueButtonText}>Șterge coada eșuată</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}

        {profile ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Mașina asignată</Text>
            {!assignedMachineId ? (
              <Text style={styles.noMachine}>Nicio mașină asignată</Text>
            ) : machine ? (
              <View style={styles.machineRow}>
                <MaterialCommunityIcons
                  name={MACHINE_MDI[machine.machineType] ?? 'map-marker'}
                  size={28}
                  color={colors.primary}
                />
                <View>
                  <Text style={styles.machineCode}>{machine.internalCode}</Text>
                  <Text style={styles.machineDetail}>
                    {machine.make} {machine.model}
                  </Text>
                  {machine.registrationPlate ? (
                    <Text style={styles.machinePlate}>{machine.registrationPlate}</Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <Text style={styles.noMachine}>Nu s-a putut încărca mașina</Text>
            )}
          </View>
        ) : null}

        {showStats && profile ? (
          <View style={styles.statsSection}>
            <Text style={styles.sectionTitle}>Starea mea</Text>
            <OperatorStats operatorId={profile.id} role={profile.role} />
          </View>
        ) : null}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Deconectare</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const LOGOUT_HEIGHT = scale(60);
const LOGOUT_RADIUS = scale(16);
const CARD_RADIUS = scale(16);
const CARD_PADDING = scale(16);
const BODY_TOP_RADIUS = scale(24);
const HEADER_PH = scale(20);
const HEADER_PT = scale(16);
const HEADER_PB = scale(32);
const CONTENT_PADDING = scale(16);

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  safeArea: {
    backgroundColor: colors.primary,
  },
  headerSection: {
    paddingHorizontal: HEADER_PH,
    paddingTop: HEADER_PT,
    paddingBottom: HEADER_PB,
    alignItems: 'center',
    gap: 8,
  },
  fullName: { fontSize: fontScale(22), fontWeight: '700', color: colors.white },
  email: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' },
  roleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 5,
    marginTop: 4,
  },
  roleText: { fontSize: fontScale(13), fontWeight: '600', color: colors.white },
  errorText: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontStyle: 'italic' },
  body: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: BODY_TOP_RADIUS,
    borderTopRightRadius: BODY_TOP_RADIUS,
  },
  content: {
    padding: CONTENT_PADDING,
    gap: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: CARD_RADIUS,
    padding: CARD_PADDING,
    gap: 8,
    alignItems: 'flex-start',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  syncLabel: { fontSize: 13, color: '#8D6E63' },
  syncValue: { fontSize: 14, fontWeight: '600', color: '#374151' },
  syncValueHighlight: { color: '#E65100' },
  syncFailedHint: {
    fontSize: 12,
    color: '#BF360C',
    marginTop: 4,
    lineHeight: 17,
  },
  syncHint: { fontSize: 13, color: colors.primary, fontStyle: 'italic' },
  syncButton: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  syncButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  retryButton: {
    marginTop: 8,
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E65100',
  },
  retryButtonText: { color: '#E65100', fontSize: 15, fontWeight: '700' },
  clearQueueButton: {
    marginTop: 6,
    paddingVertical: 8,
    alignItems: 'center',
    width: '100%',
  },
  clearQueueButtonText: {
    color: '#8D6E63',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  statsSection: { gap: 10 },
  sectionTitle: {
    fontSize: fontScale(17),
    fontWeight: '700',
    color: colors.primary,
    marginTop: 4,
  },
  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  machineCode: { fontSize: fontScale(16), fontWeight: '700', color: colors.primary },
  machineDetail: { fontSize: 13, color: colors.neutral },
  machinePlate: { fontSize: 12, color: '#9ca3af' },
  noMachine: { fontSize: 14, color: '#8D6E63', fontStyle: 'italic' },
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: LOGOUT_RADIUS,
    height: LOGOUT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  logoutText: { color: colors.white, fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
