import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { QRScanner } from '@/components/shared/QRScanner';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { ProblemReportModal } from '@/components/shared/ProblemReportModal';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';
import { useTrucksAtLoader } from '@/hooks/useTrucksAtLoader';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';
import { colors } from '@strawboss/ui-tokens';
import type { TruckAtLoader } from '@strawboss/api';
import type { MyTask } from '@/hooks/useMyTasks';

/**
 * Loader home: never asks the operator to pick a field.
 *
 *  • Top: current parcel banner (auto-resolved) OR "start work" prompt
 *    when no in_progress task and GPS is outside any assigned parcel.
 *  • Body: list of trucks physically at the loader (10s polling).
 *  • Footer: QR scanner fallback for trucks not in the geofence list.
 */
export default function LoaderHomeScreen() {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const parcel = useCurrentLoaderParcel();
  const trucks = useTrucksAtLoader({ pollMs: 10_000 });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    parcel.refresh();
    await trucks.refetch();
    setRefreshing(false);
  }, [parcel, trucks]);

  const goToLoad = useCallback((truckId: string) => {
    router.push(`/loader-ops/load-bales?truckId=${truckId}` as `/${string}`);
  }, []);

  const handleScan = useCallback(
    (data: string) => {
      setScanError(null);
      const match = data.match(/strawboss:\/\/truck\/([a-zA-Z0-9-]+)/);
      if (!match) {
        setScanError('Cod QR invalid. Scanați codul de pe camion.');
        return;
      }
      setScannerOpen(false);
      goToLoad(match[1]);
    },
    [goToLoad],
  );

  const handleStartTask = useCallback(async (task: MyTask) => {
    try {
      await mobileApiClient.post(`/api/v1/task-assignments/${task.id}/start`, {});
      parcel.refresh();
    } catch (err) {
      mobileLogger.error('Failed to start task', {
        taskId: task.id,
        err: err instanceof Error ? err.message : String(err),
      });
      Alert.alert('Eroare', 'Nu s-a putut porni sarcina. Încearcă din nou.');
    }
  }, [parcel]);

  return (
    <View style={styles.outer}>
      <ScreenHeader
        title="Camioane"
        right={
          <View style={styles.headerRight}>
            <ConnectionStatusBadge />
            <NotificationBell />
          </View>
        }
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <ParcelBanner parcel={parcel} onStartTask={handleStartTask} />

        <View style={styles.trucksHeader}>
          <Text style={styles.sectionTitle}>Camioane la loader</Text>
          {trucks.isFetching && !trucks.isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </View>

        {!assignedMachineId ? (
          <EmptyCard
            icon="alert-circle-outline"
            title="Nu ai loader asignat"
            subtitle="Cere administratorului să-ți aloce un loader."
          />
        ) : trucks.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Caut camioane...</Text>
          </View>
        ) : (trucks.data ?? []).length === 0 ? (
          <EmptyCard
            icon="truck-outline"
            title="Niciun camion în apropiere"
            subtitle="Lista se actualizează automat la fiecare 10 secunde. Când un camion se apropie, apare aici."
          />
        ) : (
          (trucks.data ?? []).map((truck) => (
            <TruckCard key={truck.id} truck={truck} onPress={() => goToLoad(truck.id)} />
          ))
        )}

        <View style={styles.fallbackBlock}>
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => {
              setScanError(null);
              setScannerOpen(true);
            }}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={20} color={colors.primary} />
            <Text style={styles.scanBtnText}>Scanează QR camion</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scanBtn, styles.scanBtnSecondary]}
            onPress={() => setProblemOpen(true)}
          >
            <MaterialCommunityIcons name="alert-octagon-outline" size={20} color="#991B1B" />
            <Text style={[styles.scanBtnText, styles.scanBtnTextSecondary]}>
              Raportează problemă
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Scanează camion</Text>
            <TouchableOpacity onPress={() => setScannerOpen(false)}>
              <MaterialCommunityIcons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalScanner}>
            <QRScanner onScan={handleScan} />
          </View>
          {scanError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      <ProblemReportModal
        visible={problemOpen}
        onClose={() => setProblemOpen(false)}
        machineId={assignedMachineId ?? undefined}
      />
    </View>
  );
}

function ParcelBanner({
  parcel,
  onStartTask,
}: {
  parcel: ReturnType<typeof useCurrentLoaderParcel>;
  onStartTask: (task: MyTask) => Promise<void>;
}) {
  if (parcel.status === 'loading') {
    return (
      <View style={styles.parcelBanner}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (parcel.status === 'resolved') {
    return (
      <View style={styles.parcelBanner}>
        <View style={styles.parcelHeader}>
          <MaterialCommunityIcons name="map-marker-radius" size={20} color={colors.primary} />
          <Text style={styles.parcelLabel}>Teren activ</Text>
        </View>
        <Text style={styles.parcelName}>{parcel.parcelName}</Text>
        <Text style={styles.parcelHint}>
          {parcel.source === 'gps'
            ? 'Detectat automat după poziție'
            : 'Sarcină în lucru'}
        </Text>
      </View>
    );
  }

  if (parcel.status === 'needs_start') {
    return (
      <View style={styles.parcelBannerPrompt}>
        <View style={styles.parcelHeader}>
          <MaterialCommunityIcons name="play-circle-outline" size={20} color="#B7791F" />
          <Text style={[styles.parcelLabel, { color: '#B7791F' }]}>Începe lucrul</Text>
        </View>
        <Text style={styles.parcelHint}>
          Alege parcela pe care lucrezi astăzi:
        </Text>
        {parcel.candidates.map((task) => (
          <TouchableOpacity
            key={task.id}
            style={styles.candidateBtn}
            onPress={() => void onStartTask(task)}
          >
            <Text style={styles.candidateText}>{task.parcelName ?? 'Parcelă'}</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.primary} />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // 'unavailable' — no candidates
  return (
    <View style={styles.parcelBanner}>
      <View style={styles.parcelHeader}>
        <MaterialCommunityIcons name="map-marker-off" size={20} color="#991B1B" />
        <Text style={[styles.parcelLabel, { color: '#991B1B' }]}>Niciun teren asignat</Text>
      </View>
      <Text style={styles.parcelHint}>
        Cere dispecerului să te asigneze pe o parcelă astăzi.
      </Text>
    </View>
  );
}

function TruckCard({ truck, onPress }: { truck: TruckAtLoader; onPress: () => void }) {
  const label = truck.registrationPlate ?? truck.internalCode ?? 'Camion';
  const distance = truck.distanceM != null ? `${Math.round(truck.distanceM)} m` : '?';
  return (
    <TouchableOpacity style={styles.truckCard} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.truckRow}>
        <View style={styles.truckIconWrap}>
          <MaterialCommunityIcons name="truck" size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.truckPlate}>{label}</Text>
          {truck.driverName ? <Text style={styles.truckMeta}>{truck.driverName}</Text> : null}
          <Text style={styles.truckDistance}>la {distance}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.tertiary} />
      </View>
    </TouchableOpacity>
  );
}

function EmptyCard({ icon, title, subtitle }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; subtitle: string }) {
  return (
    <View style={styles.emptyCard}>
      <MaterialCommunityIcons name={icon} size={28} color={colors.tertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.primary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 12 },

  parcelBanner: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  parcelBannerPrompt: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#B7791F',
  },
  parcelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  parcelLabel: { fontSize: 12, fontWeight: '600', color: colors.primary, textTransform: 'uppercase' },
  parcelName: { fontSize: 20, fontWeight: '700', color: '#0A5C36', marginTop: 2 },
  parcelHint: { fontSize: 13, color: '#5D4037' },
  candidateBtn: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  candidateText: { fontSize: 16, fontWeight: '600', color: '#0A5C36' },

  trucksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },

  truckCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  truckIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckPlate: { fontSize: 18, fontWeight: '700', color: '#0A5C36' },
  truckMeta: { fontSize: 13, color: '#5D4037', marginTop: 1 },
  truckDistance: { fontSize: 12, color: colors.tertiary, marginTop: 2 },

  emptyCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySub: { fontSize: 13, color: '#8D6E63', textAlign: 'center', lineHeight: 18 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 14, color: '#5D4037' },

  fallbackBlock: { marginTop: 16, gap: 8 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  scanBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  scanBtnSecondary: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  scanBtnTextSecondary: { color: '#991B1B' },

  modalRoot: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  modalScanner: { flex: 1 },
  errorBox: { backgroundColor: '#FEE2E2', padding: 12 },
  errorText: { color: '#991B1B', fontSize: 13, textAlign: 'center' },
});
