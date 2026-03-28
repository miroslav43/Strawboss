import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { User, Machine } from '@strawboss/types';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { mobileApiClient } from '@/lib/api-client';

const MACHINE_EMOJI: Record<string, string> = {
  loader: '🔧',
  baler:  '🌾',
  truck:  '🚛',
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

  // Fetch the current user's profile — includes assignedMachineId.
  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  // If a machine is assigned, fetch its details.
  const assignedMachineId = profile?.assignedMachineId ?? null;
  const { data: machine, isLoading: machineLoading } = useQuery({
    queryKey: ['machine', assignedMachineId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${assignedMachineId}`),
    enabled: !!assignedMachineId,
  });

  const { isTracking, error: trackingError, lastReportedAt, startTracking, stopTracking } =
    useLocationTracking();

  const handleToggleTracking = async () => {
    if (isTracking) {
      stopTracking();
    } else if (assignedMachineId) {
      await startTracking(assignedMachineId);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchProfile(), triggerSync()]);
    setRefreshing(false);
  };

  const isLoadingMachine = profileLoading || (!!assignedMachineId && machineLoading);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>StrawBoss</Text>
        <Text style={styles.subtitle}>Agricultural Logistics</Text>

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
            /* No machine assigned */
            <View style={styles.noMachineBox}>
              <Text style={styles.noMachineEmoji}>🚫</Text>
              <Text style={styles.noMachineTitle}>Nicio mașină asignată</Text>
              <Text style={styles.noMachineSubtitle}>
                Contactează administratorul pentru a-ți asigna o mașină.
              </Text>
            </View>
          ) : machine ? (
            /* Machine found */
            <>
              <View style={styles.machineCard}>
                <Text style={styles.machineEmoji}>
                  {MACHINE_EMOJI[machine.machineType] ?? '📍'}
                </Text>
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

              {/* Tracking toggle */}
              <TouchableOpacity
                style={[
                  styles.trackingButton,
                  isTracking ? styles.trackingButtonActive : styles.trackingButtonIdle,
                ]}
                onPress={handleToggleTracking}
                activeOpacity={0.8}
              >
                <View style={styles.trackingButtonInner}>
                  <View
                    style={[
                      styles.trackingDot,
                      { backgroundColor: isTracking ? '#fff' : '#9ca3af' },
                    ]}
                  />
                  <Text style={styles.trackingButtonText}>
                    {isTracking ? 'Oprește tracking GPS' : 'Pornește tracking GPS'}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Active badge */}
              {isTracking && (
                <View style={styles.trackingBadge}>
                  <View style={styles.pulseDot} />
                  <View>
                    <Text style={styles.trackingBadgeText}>
                      Tracking activ — {MACHINE_EMOJI[machine.machineType] ?? '📍'}{' '}
                      {machine.internalCode}
                    </Text>
                    {lastReportedAt && (
                      <Text style={styles.lastReportedText}>
                        Ultimul ping: {lastReportedAt}
                      </Text>
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
            <Text style={styles.label}>Schimbări în așteptare:</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F3DED8' },
  content:         { padding: 16, gap: 16 },
  title:           { fontSize: 28, fontWeight: '700', color: '#0A5C36' },
  subtitle:        { fontSize: 14, color: '#5D4037', marginBottom: 8 },

  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle:  { fontSize: 16, fontWeight: '600', color: '#5D4037' },

  statusRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot:  { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 14, color: '#000' },

  infoRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:      { fontSize: 14, color: '#5D4037' },
  value:      { fontSize: 14, fontWeight: '600', color: '#000' },
  syncingText:{ fontSize: 14, color: '#0A5C36', fontStyle: 'italic' },

  noMachineBox: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  noMachineEmoji:    { fontSize: 32 },
  noMachineTitle:    { fontSize: 15, fontWeight: '600', color: '#374151' },
  noMachineSubtitle: { fontSize: 13, color: '#8D6E63', textAlign: 'center' },

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
  machineEmoji:  { fontSize: 26 },
  machineInfo:   { flex: 1 },
  machineCode:   { fontSize: 16, fontWeight: '700', color: '#0A5C36' },
  machineDetail: { fontSize: 13, color: '#5D4037', marginTop: 2 },
  machinePlate:  { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  trackingButton: { borderRadius: 10, padding: 14, marginTop: 4 },
  trackingButtonIdle:   { backgroundColor: '#0A5C36' },
  trackingButtonActive: { backgroundColor: '#C62828' },
  trackingButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  trackingDot:       { width: 8, height: 8, borderRadius: 4 },
  trackingButtonText:{ fontSize: 15, fontWeight: '700', color: '#fff' },

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
  pulseDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' },
  trackingBadgeText: { fontSize: 13, color: '#15803d', fontWeight: '500' },
  lastReportedText:  { fontSize: 11, color: '#6b7280', marginTop: 2 },

  errorText: { fontSize: 13, color: '#C62828', fontStyle: 'italic' },
});
