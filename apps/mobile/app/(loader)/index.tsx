import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { ActiveFieldCard } from '@/components/shared/ActiveFieldCard';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';
import { useTrucksAtLoader } from '@/hooks/useTrucksAtLoader';
import { useAuxiliaryTrips } from '@/hooks/useAuxiliaryTrips';
import type { AuxiliaryTrip } from '@/hooks/useAuxiliaryTrips';
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
 */
export default function LoaderHomeScreen() {
  const { colors: themeColors } = useTheme();
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const parcel = useCurrentLoaderParcel();
  const trucks = useTrucksAtLoader({ pollMs: 10_000 });
  const auxTrips = useAuxiliaryTrips({ pollMs: 15_000 });
  const [refreshing, setRefreshing] = useState(false);
  const { modalProps } = useModal();

  // Plan C — loader recall prompt card (T13/T14).
  const recall = useLoaderRecallPrompt();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    parcel.refresh();
    await Promise.all([trucks.refetch(), auxTrips.refetch()]);
    setRefreshing(false);
  }, [parcel, trucks, auxTrips]);

  const goToLoad = useCallback((truckId: string) => {
    router.push({
      pathname: '/loader-ops/load-bales',
      params: { truckId },
    });
  }, []);

  const goToAuxLoad = useCallback((trip: AuxiliaryTrip) => {
    router.push({
      pathname: '/loader-ops/load-bales',
      params: {
        truckId: trip.id,
        parcelId: trip.sourceParcelId ?? '',
        isAuxiliary: '1',
      },
    });
  }, []);

  // Open the read-only parcel detail (same view the baler uses). Viewing
  // details never re-resolves the active parcel — GPS stays the source of truth.
  const openParcel = useCallback((id: string) => {
    router.push(`/(loader)/parcel/${id}`);
  }, []);

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

        <ActiveFieldCard parcel={parcel} onOpenParcel={openParcel} />

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

        {/* ─── Auxiliary trucks section ─────────────────────────────────── */}
        {assignedMachineId ? (
          <>
            <View style={styles.trucksHeader}>
              <Text style={styles.sectionTitle}>Camioane auxiliare</Text>
              {auxTrips.isFetching && !auxTrips.isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : null}
            </View>

            {auxTrips.isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Caut camioane auxiliare...</Text>
              </View>
            ) : (auxTrips.data ?? []).length === 0 ? (
              <EmptyCard
                icon="truck-plus-outline"
                title="Niciun camion auxiliar"
                subtitle="Camioanele auxiliare atribuite de dispecer apar aici, indiferent de distanță."
              />
            ) : (
              (auxTrips.data ?? []).map((trip) => (
                <AuxTruckCard key={trip.id} trip={trip} onPress={() => goToAuxLoad(trip)} />
              ))
            )}
          </>
        ) : null}
      </ScrollView>

      <AppModal {...modalProps} />
    </View>
  );
}

// ─── TruckCard / EmptyCard ────────────────────────────────────────────────────

function TruckCard({ truck, onPress }: { truck: TruckAtLoader; onPress: () => void }) {
  const label = truck.registrationPlate ?? truck.internalCode ?? 'Camion';
  const distance = truck.distanceM != null ? `${Math.round(truck.distanceM)} m` : '?';
  const isLoaded = truck.loadState === 'loaded';
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
        {/* Loaded / ready-to-load badge, in line with the truck row. */}
        <View style={[styles.loadBadge, isLoaded ? styles.loadBadgeLoaded : styles.loadBadgeEmpty]}>
          <MaterialCommunityIcons
            name={isLoaded ? 'package-variant-closed' : 'package-variant'}
            size={13}
            color={isLoaded ? '#0A5C36' : '#92400E'}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.loadBadgeText,
              isLoaded ? styles.loadBadgeTextLoaded : styles.loadBadgeTextEmpty,
            ]}
          >
            {isLoaded ? 'Încărcat' : 'Pregătit de încărcare'}
          </Text>
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

function AuxTruckCard({ trip, onPress }: { trip: AuxiliaryTrip; onPress?: () => void }) {
  const label = trip.truckPlate ?? trip.truckCode ?? 'Camion auxiliar';
  const parcelLine = [trip.sourceParcelName, trip.sourceParcelMunicipality]
    .filter(Boolean)
    .join(', ');
  const disabled = !onPress;

  return (
    <TouchableOpacity
      style={[auxStyles.card, disabled && auxStyles.cardDisabled]}
      activeOpacity={disabled ? 1 : 0.85}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.truckRow}>
        <View style={auxStyles.iconWrap}>
          <MaterialCommunityIcons name="truck-plus" size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={auxStyles.plateRow}>
            <Text style={styles.truckPlate} numberOfLines={1} ellipsizeMode="tail">
              {label}
            </Text>
            <View style={auxStyles.auxBadge}>
              <Text style={auxStyles.auxBadgeText}>AUX</Text>
            </View>
          </View>
          {trip.externalDriverName ? (
            <Text style={styles.truckMeta} numberOfLines={1} ellipsizeMode="tail">
              {trip.externalDriverName}
              {trip.externalDriverPhone ? `  •  ${trip.externalDriverPhone}` : ''}
            </Text>
          ) : null}
          {parcelLine ? (
            <Text style={auxStyles.parcelLine} numberOfLines={1} ellipsizeMode="tail">
              <MaterialCommunityIcons name="map-marker" size={11} color={colors.textSecondary} />{' '}
              {parcelLine}
            </Text>
          ) : null}
          {trip.cropType ? (
            <Text style={auxStyles.metaLine} numberOfLines={1} ellipsizeMode="tail">
              {trip.cropType}
              {trip.baleCount != null ? `  ·  ${trip.baleCount} baloți` : ''}
            </Text>
          ) : trip.baleCount != null ? (
            <Text style={auxStyles.metaLine}>{trip.baleCount} baloți</Text>
          ) : null}
        </View>
        {!disabled ? (
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.tertiary} />
        ) : null}
      </View>
    </TouchableOpacity>
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
  loadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  loadBadgeLoaded: { backgroundColor: '#E8F5EE' },
  loadBadgeEmpty: { backgroundColor: '#FEF3C7' },
  loadBadgeText: { fontSize: 12, fontWeight: '700' },
  loadBadgeTextLoaded: { color: '#0A5C36' },
  loadBadgeTextEmpty: { color: '#92400E' },

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

// Auxiliary truck card styles.
const auxStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    borderLeftWidth: 3,
    borderLeftColor: '#7C3AED',
  },
  cardDisabled: {
    opacity: 0.6,
    borderLeftColor: '#D1D5DB',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  auxBadge: {
    backgroundColor: '#7C3AED',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  auxBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  parcelLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  metaLine: {
    fontSize: 12,
    color: '#5D4037',
    marginTop: 1,
  },
  disabledHint: {
    fontSize: 11,
    color: '#991B1B',
    fontStyle: 'italic',
    marginTop: 3,
  },
});
