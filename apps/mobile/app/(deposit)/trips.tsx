import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { useDepotInventory, useDepotList } from '@/hooks/useDepotInventory';
import { useTheme } from '@/lib/theme';
import { colors, radii } from '@strawboss/ui-tokens';

const STATUS_LABELS: Record<string, string> = {
  in_transit: 'În drum',
  arrived: 'Sosit',
  delivering: 'Se livrează',
};

const STATUS_COLORS: Record<string, string> = {
  in_transit: '#8D6E63',
  arrived: '#2E7D32',
  delivering: '#B7791F',
};

/**
 * Plan C — incoming trips list for depot manager. Same data source as the
 * Inventar tab but rendered as a full-screen scrollable list.
 */
export default function DepositTripsScreen() {
  const { colors: themeColors } = useTheme();
  const { data: depots } = useDepotList();
  const depotId = depots?.[0]?.id ?? null;
  const query = useDepotInventory(depotId);
  const [refreshing, setRefreshing] = useState(false);
  const incoming = query.data?.incoming ?? [];

  return (
    <View style={[styles.outer, { backgroundColor: themeColors.primary }]}>
      <ScreenHeader
        title="Curse incoming"
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
                <Text style={styles.emptyTitle}>Nicio cursă incoming</Text>
                <Text style={styles.emptySubtitle}>
                  Cursele care vin spre depozit vor apărea aici.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.tripCard}>
                <View style={styles.tripHeader}>
                  <Text style={styles.tripNumber} numberOfLines={1}>
                    {item.tripNumber}
                    {item.iterationIndex && item.iterationIndex > 1
                      ? ` · cursa ${item.iterationIndex}`
                      : ''}
                  </Text>
                  <View style={styles.tripHeaderRight}>
                    {item.isInsideGeofence ? (
                      <View style={styles.geofenceBadge}>
                        <MaterialCommunityIcons name="map-marker-check" size={12} color="#FFFFFF" />
                        <Text style={styles.geofenceBadgeText}>în perimetru</Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037',
                        },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {STATUS_LABELS[item.status] ?? item.status}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.tripRow}>
                  <MaterialCommunityIcons name="truck" size={16} color={themeColors.primary} />
                  <Text style={styles.tripText} numberOfLines={1}>
                    {item.truckCode ?? item.truckPlate ?? '—'}
                  </Text>
                </View>
                <View style={styles.tripRow}>
                  <MaterialCommunityIcons name="account" size={16} color={themeColors.primary} />
                  <Text style={styles.tripText} numberOfLines={1}>
                    {item.driverName ?? '—'}
                  </Text>
                </View>
                <View style={styles.tripRow}>
                  <MaterialCommunityIcons name="grain" size={16} color={themeColors.primary} />
                  <Text style={styles.tripText}>{item.baleCount} baloți</Text>
                </View>
                {/* Distance readout */}
                <View style={styles.tripRow}>
                  <MaterialCommunityIcons
                    name="map-marker-distance"
                    size={16}
                    color={item.isInsideGeofence ? themeColors.primary : '#8D6E63'}
                  />
                  <Text style={[styles.tripText, item.isInsideGeofence && styles.tripTextInside]}>
                    {item.distanceM != null
                      ? item.isInsideGeofence
                        ? 'În perimetrul depozitului'
                        : `La ${item.distanceM} m de depozit`
                      : 'Poziție necunoscută'}
                  </Text>
                </View>
                {/* Confirm CTA — only when awaiting confirmation and inside geofence */}
                {item.awaitingConfirmation ? (
                  <TouchableOpacity
                    style={[
                      styles.confirmButton,
                      !item.isInsideGeofence && styles.confirmButtonDisabled,
                    ]}
                    activeOpacity={item.isInsideGeofence ? 0.8 : 1}
                    onPress={() => {
                      if (!item.isInsideGeofence) return;
                      router.push(
                        `/(deposit)/confirm-delivery?tripId=${item.tripId}` as Parameters<
                          typeof router.push
                        >[0],
                      );
                    }}
                  >
                    <MaterialCommunityIcons
                      name="clipboard-check"
                      size={16}
                      color={item.isInsideGeofence ? '#FFFFFF' : '#9CA3AF'}
                    />
                    <Text
                      style={[
                        styles.confirmButtonText,
                        !item.isInsideGeofence && styles.confirmButtonTextDisabled,
                      ]}
                    >
                      Confirmă livrarea
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  list: { padding: 16, gap: 10 },
  tripCard: {
    backgroundColor: '#FFF',
    borderRadius: radii.md,
    padding: 14,
    gap: 6,
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  tripNumber: { flex: 1, fontSize: 15, fontWeight: '600', color: '#374151' },
  tripHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { flexShrink: 0, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  geofenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0A5C36',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  geofenceBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tripText: { flex: 1, fontSize: 13, color: '#5D4037' },
  tripTextInside: { color: '#0A5C36', fontWeight: '600' },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0A5C36',
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 4,
  },
  confirmButtonDisabled: { backgroundColor: '#E5E7EB' },
  confirmButtonText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  confirmButtonTextDisabled: { color: '#9CA3AF' },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
