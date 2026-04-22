import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { User, Machine } from '@strawboss/types';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { mobileApiClient } from '@/lib/api-client';

type MachineIconName = 'wrench' | 'grain' | 'truck' | 'map-marker';
const MACHINE_MDI: Record<string, MachineIconName> = {
  loader: 'wrench',
  baler:  'grain',
  truck:  'truck',
};

const MACHINE_TYPE_LABEL: Record<string, string> = {
  loader: 'Încărcător',
  baler:  'Balotieră',
  truck:  'Camion',
};

export default function HomeScreen() {
  const { isConnected } = useNetworkStatus();
  const { pendingCount, lastSyncAt, triggerSync, syncing } = useSync();
  const [refreshing, setRefreshing] = useState(false);

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  const assignedMachineId = profile?.assignedMachineId ?? null;
  const { data: machine, isLoading: machineLoading } = useQuery({
    queryKey: ['machine', assignedMachineId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${assignedMachineId}`),
    enabled: !!assignedMachineId,
  });

  const { isTracking, error: trackingError, lastReportedAt, refresh: refreshTracking } =
    useLocationTracking();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchProfile(), triggerSync(), refreshTracking()]);
    setRefreshing(false);
  };

  const isLoadingMachine = profileLoading || (!!assignedMachineId && machineLoading);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>StrawBoss</Text>
          <Text style={styles.subtitle}>Agricultural Logistics</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Connection status */}
        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Conexiune</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#2E7D32' : '#C62828' },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Assigned machine + GPS tracking */}
        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Mașina mea</Text>

          {isLoadingMachine ? (
            <ActivityIndicator size="small" color="#0A5C36" />
          ) : !assignedMachineId ? (
            <View style={styles.noMachineBox}>
              <MaterialCommunityIcons name="cancel" size={32} color="#374151" />
              <Text style={styles.noMachineTitle}>Nicio mașină asignată</Text>
              <Text style={styles.noMachineSubtitle}>
                Contactează administratorul pentru a-ți asigna o mașină.
              </Text>
            </View>
          ) : machine ? (
            <>
              <View style={styles.machineCard}>
                <MaterialCommunityIcons
                  name={MACHINE_MDI[machine.machineType] ?? 'map-marker'}
                  size={26}
                  color="#0A5C36"
                />
                <View style={styles.machineInfo}>
                  <Text style={styles.machineCode}>{machine.internalCode}</Text>
                  <Text style={styles.machineDetail}>
                    {MACHINE_TYPE_LABEL[machine.machineType] ?? machine.machineType}
                    {' · '}
                    {machine.make} {machine.model}
                  </Text>
                  {machine.registrationPlate ? (
                    <Text style={styles.machinePlate}>{machine.registrationPlate}</Text>
                  ) : null}
                </View>
              </View>

              <View
                style={[
                  styles.trackingStatusBar,
                  isTracking ? styles.trackingStatusActive : styles.trackingStatusIdle,
                ]}
              >
                <View style={styles.trackingButtonInner}>
                  <View
                    style={[
                      styles.trackingDot,
                      { backgroundColor: isTracking ? '#16a34a' : '#9ca3af' },
                    ]}
                  />
                  <Text style={styles.trackingStatusText}>
                    {Platform.OS === 'android'
                      ? isTracking
                        ? 'GPS activ (inclusiv în fundal)'
                        : 'GPS nu rulează — verifică permisiunile „Tot timpul"'
                      : isTracking
                        ? 'GPS activ'
                        : 'GPS: pornește din setările aplicației (iOS)'}
                  </Text>
                </View>
              </View>

              {(isTracking || lastReportedAt) && (
                <View style={styles.trackingBadge}>
                  {isTracking ? <View style={styles.pulseDot} /> : <View style={styles.trackingDotMuted} />}
                  <View>
                    <View style={styles.inlineRow}>
                      <MaterialCommunityIcons
                        name={MACHINE_MDI[machine.machineType] ?? 'map-marker'}
                        size={13}
                        color="#15803d"
                      />
                      <Text style={styles.trackingBadgeText}>{machine.internalCode}</Text>
                    </View>
                    {lastReportedAt ? (
                      <Text style={styles.lastReportedText}>Ultimul ping: {lastReportedAt}</Text>
                    ) : (
                      <Text style={styles.lastReportedText}>Așteptând primul ping…</Text>
                    )}
                  </View>
                </View>
              )}

              {trackingError ? (
                <Text style={styles.errorText}>{trackingError}</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.errorText}>Nu s-a putut încărca mașina asignată.</Text>
          )}
        </View>

        {/* Sync status */}
        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Sincronizare</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>În coadă (inclusiv erori):</Text>
            <Text style={styles.value}>{pendingCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Ultima sincronizare:</Text>
            <Text style={styles.value}>
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString('ro-RO') : 'Niciodată'}
            </Text>
          </View>
          {syncing && (
            <Text style={styles.syncingText}>Se sincronizează...</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  safeArea: { backgroundColor: '#0A5C36' },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 16 },

  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 14, color: '#000' },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, color: '#5D4037' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  syncingText: { fontSize: 14, color: '#0A5C36', fontStyle: 'italic' },

  noMachineBox: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  noMachineTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  noMachineSubtitle: { fontSize: 13, color: '#8D6E63', textAlign: 'center' },

  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  machineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0F9F4',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  machineInfo: { flex: 1 },
  machineCode: { fontSize: 16, fontWeight: '700', color: '#0A5C36' },
  machineDetail: { fontSize: 13, color: '#5D4037', marginTop: 2 },
  machinePlate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  trackingStatusBar: {
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
    borderWidth: 1,
  },
  trackingStatusActive: { backgroundColor: '#F0F9F4', borderColor: '#BBF7D0' },
  trackingStatusIdle: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  trackingButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  trackingDot: { width: 8, height: 8, borderRadius: 4 },
  trackingDotMuted: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d1d5db' },
  trackingStatusText: { fontSize: 14, fontWeight: '600', color: '#374151', flex: 1 },

  trackingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F9F4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' },
  trackingBadgeText: { fontSize: 13, color: '#15803d', fontWeight: '500' },
  lastReportedText: { fontSize: 11, color: '#6b7280', marginTop: 2 },

  errorText: { fontSize: 13, color: '#C62828', fontStyle: 'italic' },
});
