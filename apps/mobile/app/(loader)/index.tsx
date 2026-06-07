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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
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
import { useLoaderRecallPrompt } from '@/hooks/useLoaderRecallPrompt';
import { colors, radii } from '@strawboss/ui-tokens';
import type { TruckAtLoader } from '@strawboss/api';
import { useTheme } from '@/lib/theme';

/**
 * Loader home: never asks the operator to pick a field on first load.
 *
 *  • Top: current parcel banner (auto-resolved via GPS or in_progress task),
 *    or prompt when resolution fails.
 *  • Body: list of trucks physically at the loader (10s polling).
 *  • Footer: QR scanner fallback for trucks not in the geofence list.
 */
export default function LoaderHomeScreen() {
  const { colors: themeColors } = useTheme();
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const insets = useSafeAreaInsets();
  const parcel = useCurrentLoaderParcel();
  const trucks = useTrucksAtLoader({ pollMs: 10_000 });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const { modalProps } = useModal();

  // Plan C — loader recall prompt card (T13/T14).
  const recall = useLoaderRecallPrompt();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    parcel.refresh();
    await trucks.refetch();
    setRefreshing(false);
  }, [parcel, trucks]);

  const goToLoad = useCallback((truckId: string) => {
    router.push({
      pathname: '/loader-ops/load-bales',
      params: { truckId },
    });
  }, []);

  // Open the read-only parcel detail (same view the baler uses). Viewing
  // details never re-resolves the active parcel — GPS stays the source of truth.
  const openParcel = useCallback((id: string) => {
    router.push(`/(loader)/parcel/${id}`);
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
        style={[styles.body, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={themeColors.primary}
          />
        }
      >
        {/* Plan C — loader recall prompt card (T13/T14). Shown when an
            unread loader_recall_prompt push exists. */}
        {recall.prompt ? (
          <View style={recallStyles.card}>
            <Text style={recallStyles.title}>Camion descărcat</Text>
            <Text style={recallStyles.body}>
              Camionul {recall.prompt.truckCode} a descărcat cursa. Îl chemi înapoi?
            </Text>
            <View style={recallStyles.actions}>
              <TouchableOpacity
                style={[recallStyles.btn, recallStyles.btnPrimary]}
                onPress={() => void recall.respond(true)}
                disabled={recall.pending}
              >
                <Text style={recallStyles.btnPrimaryText}>
                  {recall.pending ? '...' : 'Cheamă înapoi'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[recallStyles.btn, recallStyles.btnSecondary]}
                onPress={() => void recall.respond(false)}
                disabled={recall.pending}
              >
                <Text style={recallStyles.btnSecondaryText}>Nu chema</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ParcelBanner parcel={parcel} onOpenParcel={openParcel} />

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

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <View style={[styles.modalHeader, { paddingTop: Math.max(48, insets.top) }]}>
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
      <AppModal {...modalProps} />
    </View>
  );
}

// ─── ParcelBanner ────────────────────────────────────────────────────────────

/**
 * Loader's current-parcel banner. GPS-only resolution — the operator can
 * never pick a parcel manually. When GPS doesn't put them inside any
 * assigned parcel, the banner explains where to go and offers a refresh
 * button; no tap-to-start list is shown.
 */
function ParcelBanner({
  parcel,
  onOpenParcel,
}: {
  parcel: ReturnType<typeof useCurrentLoaderParcel>;
  onOpenParcel: (parcelId: string) => void;
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
      <TouchableOpacity
        style={styles.parcelBanner}
        activeOpacity={0.8}
        onPress={() => parcel.parcelId && onOpenParcel(parcel.parcelId)}
        disabled={!parcel.parcelId}
        accessibilityRole="button"
        accessibilityLabel="Deschide detaliile terenului"
      >
        <View style={styles.parcelHeader}>
          <MaterialCommunityIcons name="map-marker-radius" size={20} color={colors.primary} />
          <Text style={styles.parcelLabel}>Teren activ</Text>
        </View>
        <View style={styles.parcelNameRow}>
          <Text style={[styles.parcelName, { flex: 1 }]} numberOfLines={1} ellipsizeMode="tail">
            {parcel.parcelName ?? parcel.parcelCode ?? 'Teren asignat'}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.tertiary} />
        </View>
        {parcel.presence === 'inside' ? (
          <View style={[styles.presencePill, styles.presenceInside]}>
            <MaterialCommunityIcons name="check-circle" size={16} color="#0A5C36" />
            <Text style={styles.presenceInsideText}>Ești pe teren</Text>
          </View>
        ) : parcel.presence === 'outside' ? (
          <View style={[styles.presencePill, styles.presenceOutside]}>
            <MaterialCommunityIcons name="navigation-variant" size={16} color="#B7791F" />
            <Text style={styles.presenceOutsideText}>
              Mergi la teren{parcel.distanceM != null ? ` · ~${parcel.distanceM} m` : ''}
            </Text>
          </View>
        ) : (
          <View style={[styles.presencePill, styles.presenceUnknown]}>
            <MaterialCommunityIcons name="crosshairs-gps" size={16} color={colors.tertiary} />
            <Text style={styles.presenceUnknownText}>Verific poziția…</Text>
          </View>
        )}
        <Text style={styles.parcelHint}>apasă pentru detalii</Text>
      </TouchableOpacity>
    );
  }

  // multiple_active / needs_start / unavailable — all force GPS-only resolution.
  // Candidate parcels are shown only as read-only context ("you have these
  // parcels"), never as tappable list. Operator must physically reach a parcel
  // and press "Reîncearcă GPS" to re-resolve.
  const isError = parcel.status === 'multiple_active' || parcel.status === 'needs_start';
  const headerColor = isError ? '#B7791F' : '#991B1B';
  const iconName: keyof typeof MaterialCommunityIcons.glyphMap =
    parcel.status === 'multiple_active'
      ? 'map-marker-question'
      : parcel.status === 'needs_start'
        ? 'map-marker-alert'
        : 'map-marker-off';
  const headerLabel =
    parcel.status === 'multiple_active'
      ? 'GPS — nu te detectez pe teren'
      : parcel.status === 'needs_start'
        ? 'GPS — nu te detectez pe teren'
        : 'Niciun teren asignat';
  const helpText =
    parcel.status === 'unavailable'
      ? 'Cere dispecerului să te asigneze pe o parcelă astăzi.'
      : 'Mergi pe parcela pe care lucrezi și apasă „Reîncearcă GPS". Terenul se detectează automat după locație — nu se poate alege manual.';

  return (
    <View style={isError ? styles.parcelBannerPrompt : styles.parcelBanner}>
      <View style={styles.parcelHeader}>
        <MaterialCommunityIcons name={iconName} size={20} color={headerColor} />
        <Text style={[styles.parcelLabel, { color: headerColor }]}>{headerLabel}</Text>
      </View>
      <Text style={styles.parcelHint}>{helpText}</Text>
      {isError && parcel.candidates.length > 0 ? (
        <View style={styles.parcelCandidatesInfo}>
          <Text style={styles.parcelCandidatesTitle}>Terenurile tale asignate:</Text>
          {parcel.candidates.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.parcelCandidateRow}
              activeOpacity={0.7}
              disabled={!task.parcelId}
              onPress={() => task.parcelId && onOpenParcel(task.parcelId)}
              accessibilityRole="button"
              accessibilityLabel={`Deschide detaliile pentru ${task.parcelName ?? task.parcelCode ?? 'parcelă'}`}
            >
              <MaterialCommunityIcons name="circle-small" size={18} color={colors.tertiary} />
              <Text
                style={[styles.parcelCandidateText, { flex: 1 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {task.parcelName ?? task.parcelCode ?? 'Parcelă'}
              </Text>
              {task.parcelId ? (
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.tertiary} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {isError ? (
        <TouchableOpacity style={styles.refreshGpsBtn} onPress={parcel.refresh}>
          <MaterialCommunityIcons name="crosshairs-gps" size={16} color="#fff" />
          <Text style={styles.refreshGpsText}>Reîncearcă GPS</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── TruckCard / EmptyCard ────────────────────────────────────────────────────

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
          <Text style={styles.truckPlate} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
          {truck.driverName ? (
            <Text style={styles.truckMeta} numberOfLines={1} ellipsizeMode="tail">
              {truck.driverName}
            </Text>
          ) : null}
          <Text style={styles.truckDistance}>la {distance}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.tertiary} />
      </View>
    </TouchableOpacity>
  );
}

function EmptyCard({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <MaterialCommunityIcons name={icon} size={28} color={colors.tertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    borderRadius: radii.lg,
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
    borderRadius: radii.lg,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#B7791F',
  },
  parcelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  parcelLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  parcelName: { fontSize: 20, fontWeight: '700', color: '#0A5C36', marginTop: 2 },
  parcelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parcelHint: { fontSize: 13, color: colors.textSecondary },

  presencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 4,
  },
  presenceInside: { backgroundColor: '#DCFCE7' },
  presenceInsideText: { fontSize: 13, fontWeight: '700', color: '#0A5C36' },
  presenceOutside: { backgroundColor: '#FEF3C7' },
  presenceOutsideText: { fontSize: 13, fontWeight: '700', color: '#B7791F' },
  presenceUnknown: { backgroundColor: '#F1F5F9' },
  presenceUnknownText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  parcelCandidatesInfo: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FCE7B5',
  },
  parcelCandidatesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#713F12',
    marginBottom: 2,
  },
  parcelCandidateRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  parcelCandidateText: { flexShrink: 1, fontSize: 13, color: '#92400E' },
  refreshGpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: '#0A5C36',
  },
  refreshGpsText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  trucksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },

  truckCard: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
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
  truckDistance: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  emptyCard: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 14, color: '#5D4037' },

  fallbackBlock: { marginTop: 16, gap: 8 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF',
    borderRadius: radii.md,
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

// Plan C — loader recall prompt card styles.
const recallStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FEF3C7',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#FCD34D',
    padding: 14,
    gap: 10,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#92400E' },
  body: { fontSize: 14, color: '#5B3A0B', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#0A5C36' },
  btnPrimaryText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  btnSecondary: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  btnSecondaryText: { color: '#374151', fontWeight: '600', fontSize: 14 },
});
