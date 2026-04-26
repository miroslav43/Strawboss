import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from './StatCard';
import { colors } from '@strawboss/ui-tokens';
import { getDatabase } from '@/lib/storage';

interface OperatorStatsProps {
  operatorId: string;
}

interface TodayStats {
  totalFuelLiters: number;
  totalTwineKg: number;
  totalBales: number;
}

/**
 * Query key used by both this component and the save flows (production /
 * fuel / consumables). Exporting it keeps invalidation in one place: any
 * screen that enqueues a new record invalidates this key to refresh the
 * profile counters instantly, without waiting for a server round-trip.
 */
export const operatorStatsQueryKey = (operatorId: string) =>
  ['operator-stats-local', operatorId] as const;

/**
 * Today's aggregates, computed directly from the local SQLite tables. We
 * deliberately avoid the server API here — the user wants the numbers to
 * update the instant they tap "Salvează", which is *before* the sync
 * queue is drained. SQLite reflects every local write immediately.
 */
async function loadTodayStats(operatorId: string): Promise<TodayStats> {
  const db = await getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  const [balesRow, fuelRow, twineRow] = await Promise.all([
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(bale_count), 0) AS total
         FROM bale_productions
        WHERE operator_id = ?
          AND substr(production_date, 1, 10) = ?`,
      [operatorId, today],
    ),
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(quantity_liters), 0) AS total
         FROM fuel_logs
        WHERE operator_id = ?
          AND substr(logged_at, 1, 10) = ?`,
      [operatorId, today],
    ),
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM consumable_logs
        WHERE operator_id = ?
          AND consumable_type = 'twine'
          AND substr(logged_at, 1, 10) = ?`,
      [operatorId, today],
    ),
  ]);

  return {
    totalBales: Number(balesRow?.total ?? 0),
    totalFuelLiters: Number(fuelRow?.total ?? 0),
    totalTwineKg: Number(twineRow?.total ?? 0),
  };
}

export function OperatorStats({ operatorId }: OperatorStatsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: operatorStatsQueryKey(operatorId),
    queryFn: () => loadTodayStats(operatorId),
    // Recompute on focus / remount so the counters stay fresh even without
    // explicit invalidation from another screen.
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const stats = data ?? { totalFuelLiters: 0, totalTwineKg: 0, totalBales: 0 };

  return (
    <View style={styles.content}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Nu s-au putut încărca statisticile'}
          </Text>
        </View>
      ) : null}

      <StatCard label="Baloți produși azi" value={stats.totalBales} unit="buc" />
      <StatCard label="Motorină azi" value={stats.totalFuelLiters} unit="L" />
      <StatCard label="Sfoară azi" value={stats.totalTwineKg} unit="kg" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  content: {
    gap: 12,
  },
  errorBanner: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
