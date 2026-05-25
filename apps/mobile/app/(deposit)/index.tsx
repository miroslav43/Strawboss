import { useState, useMemo } from 'react';
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
import { useDepotInventory, useDepotList } from '@/hooks/useDepotInventory';
import { useTheme } from '@/lib/theme';
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
  const { colors: themeColors } = useTheme();
  const { data: depots } = useDepotList();
  const [selected, setSelected] = useState<string | null>(null);
  const depotId = selected ?? depots?.[0]?.id ?? null;
  const query = useDepotInventory(depotId);
  const [refreshing, setRefreshing] = useState(false);

  const payload = query.data;
  const lastUpdate = useMemo(() => {
    if (!payload?.inventory.lastUpdate) return null;
    return new Date(payload.inventory.lastUpdate).toLocaleString('ro-RO');
  }, [payload?.inventory.lastUpdate]);

  return (
    <View style={[styles.outer, { backgroundColor: themeColors.primary }]}>
      <ScreenHeader
        title="Inventar depozit"
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
            <Text style={styles.emptyTitle}>Niciun depozit alocat</Text>
            <Text style={styles.emptySubtitle}>
              Cere administratorului să asocieze un depozit contului tău.
            </Text>
          </View>
        ) : query.isLoading && !payload ? (
          <View style={styles.empty}>
            <ActivityIndicator color={themeColors.primary} />
          </View>
        ) : !payload ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Date indisponibile</Text>
            <Text style={styles.emptySubtitle}>
              Conectează-te la internet și trage în jos pentru a sincroniza.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{payload.depot.name}</Text>
              <Text style={styles.cardCode}>{payload.depot.code}</Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{payload.inventory.totalBales}</Text>
                  <Text style={styles.statLabel}>baloți</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {(payload.inventory.totalNetWeightKg / 1000).toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>tone</Text>
                </View>
              </View>
              {lastUpdate ? (
                <Text style={styles.lastUpdate}>Ultima livrare: {lastUpdate}</Text>
              ) : null}
            </View>

            <View style={styles.cardSecondary}>
              <Text style={styles.sectionTitle}>{payload.incoming.length} curse pe drum</Text>
              {payload.incoming.length === 0 ? (
                <Text style={styles.emptyInline}>Nicio cursă incoming.</Text>
              ) : (
                payload.incoming.slice(0, 5).map((trip) => (
                  <View key={trip.tripId} style={styles.tripRow}>
                    <MaterialCommunityIcons name="truck" size={18} color={themeColors.primary} />
                    <View style={styles.tripInfo}>
                      <Text style={styles.tripNumber}>
                        {trip.tripNumber}
                        {trip.iterationIndex && trip.iterationIndex > 1
                          ? ` · cursa ${trip.iterationIndex}`
                          : ''}
                      </Text>
                      <Text style={styles.tripSub}>
                        {trip.truckCode ?? trip.truckPlate ?? '—'} · {trip.driverName ?? '—'} ·{' '}
                        {trip.baleCount} baloți
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
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
  cardLabel: { fontSize: 18, fontWeight: '700', color: '#0A5C36' },
  cardCode: { fontSize: 13, color: colors.textSecondary },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 32, fontWeight: '700', color: '#0A5C36' },
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
