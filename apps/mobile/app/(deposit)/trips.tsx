import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { AppModal } from '@/components/shared/AppModal';
import { useModal } from '@/hooks/useModal';
import { useDepotInventory, useActiveDepotId } from '@/hooks/useDepotInventory';
import { DepotTruckCard } from '@/components/features/deposit/DepotTruckCard';
import { useStartDepotUnload } from '@/hooks/useStartDepotUnload';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { colors } from '@strawboss/ui-tokens';

/**
 * Plan C — incoming trips list for the depot manager. Same data source as the
 * Inventar tab, rendered as a full-screen scrollable list.
 */
export default function DepositTripsScreen() {
  const { t } = useI18n();
  const { colors: themeColors } = useTheme();
  const depotId = useActiveDepotId();
  const query = useDepotInventory(depotId);
  const [refreshing, setRefreshing] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();
  const startUnload = useStartDepotUnload({ depotId, showModal, hideModal });
  const incoming = query.data?.incoming ?? [];

  const handlePress = useCallback(
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

  return (
    <View style={[styles.outer, { backgroundColor: themeColors.primary }]}>
      <ScreenHeader
        title={t('depositTrips.screenTitle')}
        right={
          <View style={styles.headerRight}>
            <ConnectionStatusBadge />
            <NotificationBell />
          </View>
        }
      />
      <View style={[styles.body, { backgroundColor: themeColors.background }]}>
        {query.isLoading && !query.data ? (
          <View style={styles.empty}>
            <ActivityIndicator color={themeColors.primary} />
          </View>
        ) : (
          <FlatList
            data={incoming}
            keyExtractor={(item) => item.tripId}
            contentContainerStyle={styles.list}
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
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialCommunityIcons
                  name="truck-fast-outline"
                  size={48}
                  color={colors.textSecondary}
                />
                <Text style={styles.emptyTitle}>{t('depositTrips.emptyTitle')}</Text>
                <Text style={styles.emptySubtitle}>{t('depositTrips.emptySubtitle')}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <DepotTruckCard
                truck={item}
                onPress={handlePress}
                t={t}
                primaryColor={themeColors.primary}
              />
            )}
          />
        )}
      </View>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
