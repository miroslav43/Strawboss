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
import { useLoaderBoard } from '@/hooks/useLoaderBoard';
import { useAuxiliaryTrips } from '@/hooks/useAuxiliaryTrips';
import type { AuxiliaryTrip } from '@/hooks/useAuxiliaryTrips';
import { useLoaderRecallPrompt } from '@/hooks/useLoaderRecallPrompt';
import { colors, radii } from '@strawboss/ui-tokens';
import type { TruckAtLoader, AssignedTruck } from '@strawboss/api';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';

/**
 * Loader home: never asks the operator to pick a field on first load.
 *
 *  • Top: current parcel banner (auto-resolved via GPS or in_progress task),
 *    or prompt when resolution fails.
 *  • Body: list of trucks physically at the loader (10s polling).
 */
export default function LoaderHomeScreen() {
  const { colors: themeColors } = useTheme();
  const { t } = useI18n();
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const parcel = useCurrentLoaderParcel();
  const board = useLoaderBoard();
  const auxTrips = useAuxiliaryTrips();
  const [refreshing, setRefreshing] = useState(false);
  const { modalProps } = useModal();

  const [nearbyOpen, setNearbyOpen] = useState(true);

  const presenceRank: Record<AssignedTruck['presence'], number> = {
    here: 0,
    enroute: 1,
    unknown: 1,
    loaded: 2,
  };
  const assigned = [...(board.data?.assigned ?? [])].sort((a, b) => {
    const r = presenceRank[a.presence] - presenceRank[b.presence];
    if (r !== 0) return r;
    return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);
  });
  const nearby = board.data?.nearbyUnassigned ?? [];
  const auxList = auxTrips.data ?? [];
  const toLoadCount = assigned.length + auxList.length;

  // Plan C — loader recall prompt card (T13/T14).
  const recall = useLoaderRecallPrompt();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    parcel.refresh();
    await Promise.all([board.refetch(), auxTrips.refetch()]);
    setRefreshing(false);
  }, [parcel, board, auxTrips]);

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
        // register-load resolves the aux trip by its truck's machine id — NOT the
        // trip id. Passing trip.id here silently broke the aux load path.
        truckId: trip.truckId,
        parcelId: trip.sourceParcelId ?? '',
        isAuxiliary: '1',
        // Carried separately (never as truckId, see above) so the CMR scan can be
        // addressed offline, when there's no register-load response to read it from.
        auxTripId: trip.id,
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
        title={t('loader.home.screenTitle')}
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
            <Text style={recallStyles.title}>{t('loader.home.recallTitle')}</Text>
            <Text style={recallStyles.body}>
              {t('loader.home.recallBody', { truckCode: recall.prompt.truckCode })}
            </Text>
            <View style={recallStyles.actions}>
              <TouchableOpacity
                style={[recallStyles.btn, recallStyles.btnPrimary]}
                onPress={() => void recall.respond(true)}
                disabled={recall.pending}
              >
                <Text style={recallStyles.btnPrimaryText}>
                  {recall.pending ? '...' : t('loader.home.recallConfirm')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[recallStyles.btn, recallStyles.btnSecondary]}
                onPress={() => void recall.respond(false)}
                disabled={recall.pending}
              >
                <Text style={recallStyles.btnSecondaryText}>{t('loader.home.recallDecline')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ActiveFieldCard parcel={parcel} onOpenParcel={openParcel} />

        {/* ─── Camioane de încărcat (asignate + auxiliare) ───────────────── */}
        <View style={styles.trucksHeader}>
          <Text style={styles.sectionTitle}>
            {t('loader.home.sectionAssignedTrucks')}
            {toLoadCount > 0 ? ` (${toLoadCount})` : ''}
          </Text>
          {(board.isFetching && !board.isLoading) ||
          (auxTrips.isFetching && !auxTrips.isLoading) ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </View>

        {!assignedMachineId ? (
          <EmptyCard
            icon="alert-circle-outline"
            title={t('loader.home.noLoaderAssignedTitle')}
            subtitle={t('loader.home.noLoaderAssignedSubtitle')}
          />
        ) : board.isLoading && auxTrips.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>{t('loader.home.searchingTrucks')}</Text>
          </View>
        ) : toLoadCount === 0 ? (
          <EmptyCard
            icon="truck-outline"
            title={t('loader.home.noAssignedTrucksTitle')}
            subtitle={t('loader.home.noAssignedTrucksSubtitle')}
          />
        ) : (
          <>
            {assigned.map((truck) => (
              <AssignedTruckCard
                key={truck.tripId}
                truck={truck}
                onPress={() => goToLoad(truck.truckId)}
                t={t}
              />
            ))}
            {auxList.map((trip) => (
              <AuxTruckCard key={trip.id} trip={trip} onPress={() => goToAuxLoad(trip)} t={t} />
            ))}
          </>
        )}

        {/* ─── Alte camioane în zonă (neasignate, estompate, colapsabile) ── */}
        {assignedMachineId && nearby.length > 0 ? (
          <>
            <TouchableOpacity
              style={styles.trucksHeader}
              activeOpacity={0.7}
              onPress={() => setNearbyOpen((v) => !v)}
            >
              <Text style={styles.sectionTitleMuted}>
                {t('loader.home.sectionNearbyUnassigned')} ({nearby.length})
              </Text>
              <MaterialCommunityIcons
                name={nearbyOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.tertiary}
              />
            </TouchableOpacity>
            {nearbyOpen
              ? nearby.map((truck) => (
                  <View key={truck.id} style={styles.dimmed}>
                    <TruckCard truck={truck} onPress={() => goToLoad(truck.id)} t={t} unassigned />
                  </View>
                ))
              : null}
          </>
        ) : null}
      </ScrollView>

      <AppModal {...modalProps} />
    </View>
  );
}

// ─── TruckCard / EmptyCard ────────────────────────────────────────────────────

function TruckCard({
  truck,
  onPress,
  t,
  unassigned,
}: {
  truck: TruckAtLoader;
  onPress: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  unassigned?: boolean;
}) {
  const label =
    truck.registrationPlate ?? truck.internalCode ?? t('loader.home.truckFallbackLabel');
  const distance = truck.distanceM != null ? `${Math.round(truck.distanceM)} m` : '?';
  const isLoaded = truck.loadState === 'loaded';
  return (
    <TouchableOpacity style={styles.truckCard} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.truckRow}>
        <View style={styles.truckIconWrap}>
          <MaterialCommunityIcons name="truck" size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.plateRowInline}>
            <Text style={styles.truckPlate} numberOfLines={1} ellipsizeMode="tail">
              {label}
            </Text>
            {unassigned ? (
              <View style={styles.unassignedTag}>
                <Text style={styles.unassignedTagText}>{t('loader.home.tagUnassigned')}</Text>
              </View>
            ) : null}
          </View>
          {truck.driverName ? (
            <Text style={styles.truckMeta} numberOfLines={1} ellipsizeMode="tail">
              {truck.driverName}
            </Text>
          ) : null}
          <Text style={styles.truckDistance}>
            {t('loader.home.truckDistancePrefix', { distance })}
          </Text>
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
            {isLoaded ? t('loader.home.badgeLoaded') : t('loader.home.badgeReadyToLoad')}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.tertiary} />
      </View>
    </TouchableOpacity>
  );
}

function AssignedTruckCard({
  truck,
  onPress,
  t,
}: {
  truck: AssignedTruck;
  onPress: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const label =
    truck.registrationPlate ?? truck.internalCode ?? t('loader.home.truckFallbackLabel');
  const isLoaded = truck.presence === 'loaded';

  const distanceText =
    truck.distanceM == null
      ? null
      : truck.distanceM >= 1000
        ? t('loader.home.distanceKm', { distance: (truck.distanceM / 1000).toFixed(1) })
        : t('loader.home.distanceMeters', { distance: Math.round(truck.distanceM) });

  let badgeText: string;
  let badgeStyle: object;
  let badgeTextStyle: object;
  if (truck.presence === 'loaded') {
    badgeText = t('loader.home.badgePresenceLoaded');
    badgeStyle = styles.presenceLoaded;
    badgeTextStyle = styles.presenceLoadedText;
  } else if (truck.presence === 'here') {
    badgeText = distanceText
      ? `${t('loader.home.badgeHereNow')} · ${distanceText}`
      : t('loader.home.badgeHereNow');
    badgeStyle = styles.presenceHere;
    badgeTextStyle = styles.presenceHereText;
  } else {
    // enroute + unknown share the "on the way" badge (unknown = no recent GPS).
    badgeText = distanceText
      ? `${t('loader.home.badgeEnroute')} · ${distanceText}`
      : t('loader.home.badgeEnroute');
    badgeStyle = styles.presenceEnroute;
    badgeTextStyle = styles.presenceEnrouteText;
  }

  return (
    <TouchableOpacity
      style={[styles.truckCard, isLoaded && styles.truckCardLoaded]}
      activeOpacity={0.85}
      onPress={onPress}
    >
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
          {truck.sourceParcelName ? (
            <Text style={styles.fieldLine} numberOfLines={1} ellipsizeMode="tail">
              <MaterialCommunityIcons name="map-marker" size={11} color={colors.textSecondary} />{' '}
              {t('loader.home.fieldPrefix', { field: truck.sourceParcelName })}
            </Text>
          ) : null}
        </View>
        <View style={[styles.presenceBadge, badgeStyle]}>
          <Text numberOfLines={1} style={[styles.presenceBadgeText, badgeTextStyle]}>
            {badgeText}
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

function AuxTruckCard({
  trip,
  onPress,
  t,
}: {
  trip: AuxiliaryTrip;
  onPress?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const label = trip.truckPlate ?? trip.truckCode ?? t('loader.home.auxTruckFallbackLabel');
  const parcelLine = [trip.sourceParcelName, trip.sourceParcelMunicipality]
    .filter(Boolean)
    .join(', ');
  // Bale quality (calitate baloți) the truck must load — set by the beneficiary
  // request portal (quality_1 / quality_2), shown to the loader before loading.
  const qualityText = trip.quality
    ? trip.quality === 'quality_1'
      ? t('loader.home.quality1')
      : t('loader.home.quality2')
    : null;
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
              {trip.baleCount != null
                ? `  ·  ${t('loader.home.baleCountSuffix', { count: trip.baleCount })}`
                : ''}
            </Text>
          ) : trip.baleCount != null ? (
            <Text style={auxStyles.metaLine}>
              {t('loader.home.baleCountSuffix', { count: trip.baleCount })}
            </Text>
          ) : null}
          {qualityText ? (
            <Text style={auxStyles.qualityLine} numberOfLines={1} ellipsizeMode="tail">
              {t('loader.home.baleQualityLabel')}: {qualityText}
            </Text>
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

  sectionTitleMuted: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  truckCardLoaded: { opacity: 0.6 },
  dimmed: { opacity: 0.55 },
  fieldLine: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  plateRowInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unassignedTag: {
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  unassignedTagText: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  presenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 132,
  },
  presenceBadgeText: { fontSize: 12, fontWeight: '700' },
  presenceHere: { backgroundColor: '#E8F5EE' },
  presenceHereText: { color: '#0A5C36' },
  presenceEnroute: { backgroundColor: '#FEF3C7' },
  presenceEnrouteText: { color: '#92400E' },
  presenceLoaded: { backgroundColor: '#E5E7EB' },
  presenceLoadedText: { color: '#374151' },
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
  qualityLine: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 2,
  },
  disabledHint: {
    fontSize: 11,
    color: '#991B1B',
    fontStyle: 'italic',
    marginTop: 3,
  },
});
