import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from './StatCard';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';
import { getDatabase } from '@/lib/storage';

interface OperatorStatsProps {
  operatorId: string;
  role: string;
}

interface TodayStats {
  totalFuelLiters: number;
  totalTwineKg: number | undefined;
  totalBalesProduced: number | undefined;
  totalBalesTransported: number | undefined;
  totalBalesLoaded: number | undefined;
}

/**
 * Array-hierarchical key so `invalidateQueries({ queryKey: ['operator-stats'] })`
 * in the sync post-pull hook already invalidates every operator's local stats
 * as a side-effect, without us wiring up per-user invalidation.
 */
export const operatorStatsQueryKey = (operatorId: string) =>
  ['operator-stats', 'local', operatorId] as const;

async function loadTodayStats(operatorId: string, role: string): Promise<TodayStats> {
  const db = await getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  const fuelRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(quantity_liters), 0) AS total
       FROM fuel_logs
      WHERE operator_id = ?
        AND substr(logged_at, 1, 10) = ?`,
    [operatorId, today],
  );

  if (role === 'driver') {
    const tripsRow = await db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(bale_count), 0) AS total
         FROM trips
        WHERE driver_id = ?
          AND substr(departure_at, 1, 10) = ?`,
      [operatorId, today],
    );
    return {
      totalFuelLiters: Number(fuelRow?.total ?? 0),
      totalTwineKg: undefined,
      totalBalesProduced: undefined,
      totalBalesTransported: Number(tripsRow?.total ?? 0),
      totalBalesLoaded: undefined,
    };
  }

  if (role === 'loader_operator') {
    // Attribute bales to THIS user's individual loads rather than to the
    // trip-level `loader_operator_id`: in shared trips two loaders may each
    // register partial loads, and we want each to see only their own totals.
    const loadsRow = await db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(bale_count), 0) AS total
         FROM bale_loads
        WHERE operator_id = ?
          AND substr(loaded_at, 1, 10) = ?`,
      [operatorId, today],
    );
    return {
      totalFuelLiters: Number(fuelRow?.total ?? 0),
      totalTwineKg: undefined,
      totalBalesProduced: undefined,
      totalBalesTransported: undefined,
      totalBalesLoaded: Number(loadsRow?.total ?? 0),
    };
  }

  // baler_operator (default)
  const [balesRow, twineRow] = await Promise.all([
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(bale_count), 0) AS total
         FROM bale_productions
        WHERE operator_id = ?
          AND substr(production_date, 1, 10) = ?`,
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
    totalFuelLiters: Number(fuelRow?.total ?? 0),
    totalTwineKg: Number(twineRow?.total ?? 0),
    totalBalesProduced: Number(balesRow?.total ?? 0),
    totalBalesTransported: undefined,
    totalBalesLoaded: undefined,
  };
}

export function OperatorStats({ operatorId, role }: OperatorStatsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: operatorStatsQueryKey(operatorId),
    queryFn: () => loadTodayStats(operatorId, role),
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

  const stats = data ?? {
    totalFuelLiters: 0,
    totalTwineKg: undefined,
    totalBalesProduced: undefined,
    totalBalesTransported: undefined,
    totalBalesLoaded: undefined,
  };

  return (
    <View style={styles.content}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Nu s-au putut încărca statisticile'}
          </Text>
        </View>
      ) : null}

      {stats.totalBalesProduced !== undefined && (
        <StatCard label="Baloți produși azi" value={stats.totalBalesProduced} unit="buc" />
      )}
      {stats.totalBalesTransported !== undefined && (
        <StatCard label="Baloți transportați azi" value={stats.totalBalesTransported} unit="buc" />
      )}
      {stats.totalBalesLoaded !== undefined && (
        <StatCard label="Baloți încărcați azi" value={stats.totalBalesLoaded} unit="buc" />
      )}
      <StatCard label="Motorină azi" value={stats.totalFuelLiters} unit="L" />
      {stats.totalTwineKg !== undefined && (
        <StatCard label="Sfoară azi" value={stats.totalTwineKg} unit="kg" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    paddingVertical: scale(24),
    alignItems: 'center',
  },
  content: {
    gap: scale(12),
  },
  errorBanner: {
    backgroundColor: colors.danger,
    borderRadius: scale(12),
    padding: scale(12),
  },
  errorText: {
    color: colors.white,
    fontSize: fontScale(14),
    fontWeight: '500',
    textAlign: 'center',
  },
});
