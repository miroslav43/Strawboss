import { Redirect, router } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { AppModal } from '@/components/shared/AppModal';
import { useModal } from '@/hooks/useModal';
import {
  useDepotInventory,
  useDepotList,
  useSelectedDepotStore,
  useActiveDepotId,
} from '@/hooks/useDepotInventory';
import { DepotTruckCard } from '@/components/features/deposit/DepotTruckCard';
import { useStartDepotUnload } from '@/hooks/useStartDepotUnload';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { useIsFeatureEnabled } from '@/stores/features-store';
import { fontScale } from '@/utils/responsive';
import { colors, radii } from '@strawboss/ui-tokens';

/**
 * Plan C — depot manager landing tab.
 *
 * Shows current total bales + net weight at the selected depot and a
 * picker when the user has access to more than one. Designed to work
 * fully offline once data has been fetched at least once (TanStack
 * Query cache + write-through SQLite cache in useDepotInventory).
 */
export default function DepositInventoryScreen() {
  /*
   * `index` is this group's initial route AND the inventory screen itself, so
   * hiding its tab would land the depot manager on a screen with no tab bar
   * entry. Redirect to Trips instead — the same shape `(geofence-maker)` uses.
   */
  const inventoryEnabled = useIsFeatureEnabled('depot.inventory');
  if (!inventoryEnabled) return <Redirect href="/(deposit)/trips" />;

  const { t } = useI18n();
  const { colors: themeColors } = useTheme();
  const { data: depots } = useDepotList();
  // Shared with the Curse tab and the confirm screen, which used to hardcode
  // depots[0] and so ignored this picker entirely.
  const setSelected = useSelectedDepotStore((s) => s.setSelectedDepotId);
  const depotId = useActiveDepotId();
  const query = useDepotInventory(depotId);
  const [refreshing, setRefreshing] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();
  const startUnload = useStartDepotUnload({ depotId, showModal, hideModal });

  const payload = query.data;
  const incoming = payload?.incoming ?? [];

  const handleTruckPress = useCallback(
    (truck: (typeof incoming)[number], action: 'start' | 'finish') => {
      if (action === 'finish') {
        router.push(
          `/(deposit)/confirm-delivery?tripId=${truck.tripId}` as Parameters<typeof router.push>[0],
        );
        return;
      }
      void startUnload(truck);
    },
    [startUnload],
  );
  const lastUpdate = useMemo(() => {
    if (!payload?.inventory.lastUpdate) return null;
    return new Date(payload.inventory.lastUpdate).toLocaleString('ro-RO');
  }, [payload?.inventory.lastUpdate]);

  return (
    <View style={[styles.outer, { backgroundColor: themeColors.primary }]}>
      <ScreenHeader
        title={t('deposit.screenTitle')}
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
            tintColor={themeColors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await query.refetch();
              setRefreshing(false);
            }}
          />
        }
      >
        {(depots?.length ?? 0) > 1 ? (
          <View style={styles.depotPicker}>
            {depots!.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[styles.depotPill, depotId === d.id && styles.depotPillActive]}
                onPress={() => setSelected(d.id)}
              >
                <Text
                  style={[styles.depotPillText, depotId === d.id && styles.depotPillTextActive]}
                >
                  {d.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {!depotId ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="warehouse" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>{t('deposit.noDepotTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('deposit.noDepotSubtitle')}</Text>
          </View>
        ) : query.isLoading && !payload ? (
          <View style={styles.empty}>
            <ActivityIndicator color={themeColors.primary} />
          </View>
        ) : !payload ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('deposit.dataUnavailableTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('deposit.dataUnavailableSubtitle')}</Text>
          </View>
        ) : (
          <>
            {/*
             * Trucks first, stock second. This tab is where the depot manager
             * lands, and it used to open on an inventory total with a passive
             * five-row list underneath — no distance, no perimeter badge, no
             * button. The one thing he opens the app to do lived on another tab.
             */}
            {incoming.length > 0 ? (
              <View style={styles.trucksSection}>
                <Text style={styles.sectionTitle}>
                  {t('deposit.incomingTripsCount', { count: incoming.length })}
                </Text>
                {incoming.map((truck) => (
                  <DepotTruckCard
                    key={truck.tripId}
                    truck={truck}
                    onPress={handleTruckPress}
                    t={t}
                    primaryColor={themeColors.primary}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardLabel} numberOfLines={1} ellipsizeMode="tail">
                {payload.depot.name}
              </Text>
              <Text style={styles.cardCode}>{payload.depot.code}</Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{payload.inventory.totalBales}</Text>
                  <Text style={styles.statLabel}>{t('deposit.statLabelBales')}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {(payload.inventory.totalNetWeightKg / 1000).toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>{t('deposit.statLabelTons')}</Text>
                </View>
              </View>
              {lastUpdate ? (
                <Text style={styles.lastUpdate} numberOfLines={1} ellipsizeMode="tail">
                  {t('deposit.lastDelivery', { date: lastUpdate ?? '' })}
                </Text>
              ) : null}
            </View>

            {incoming.length === 0 ? (
              <View style={styles.cardSecondary}>
                <Text style={styles.sectionTitle}>
                  {t('deposit.incomingTripsCount', { count: 0 })}
                </Text>
                <Text style={styles.emptyInline}>{t('deposit.noIncomingTripsInline')}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 12 },
  trucksSection: { gap: 10 },
  depotPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  depotPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFF',
  },
  depotPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  depotPillText: { fontSize: 13, color: '#374151' },
  depotPillTextActive: { color: '#FFF', fontWeight: '600' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
    padding: 18,
    gap: 6,
  },
  cardSecondary: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
    padding: 16,
    gap: 10,
  },
  cardLabel: { fontSize: fontScale(18), fontWeight: '700', color: '#0A5C36' },
  cardCode: { fontSize: 13, color: colors.textSecondary },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontScale(32), fontWeight: '700', color: '#0A5C36' },
  statLabel: { fontSize: 13, color: colors.textSecondary },
  statDivider: { width: 1, height: 36, backgroundColor: '#E5E7EB' },
  lastUpdate: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0A5C36' },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tripInfo: { flex: 1 },
  tripNumber: { fontSize: 14, fontWeight: '600', color: '#374151' },
  tripSub: { fontSize: 12, color: colors.textSecondary },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyInline: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
});
