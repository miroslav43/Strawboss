import { useState, useEffect, useCallback } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatCard } from './StatCard';
import { mobileApiClient } from '@/lib/api-client';
import { colors } from '@strawboss/ui-tokens';

interface OperatorStatsProps {
  operatorId: string;
}

/**
 * Aggregates returned by `/fuel-logs/stats` and `/consumable-logs/stats`.
 * The Postgres driver serializes `SUM(...)` / `COUNT(...)` as strings for
 * `numeric` and `bigint`; we coerce with `Number(...)` on the client.
 */
interface FuelStatsResponse {
  totalLiters?: number | string;
  entryCount?: number | string;
}

interface ConsumableStatsResponse {
  totalQuantity?: number | string;
  entryCount?: number | string;
}

interface BaleProductionsResponse {
  data?: Array<{ bale_count: number }>;
  total?: number;
}

interface StatsState {
  totalFuelLiters: number;
  totalTwineKg: number;
  totalBales: number;
}

const INITIAL_STATS: StatsState = {
  totalFuelLiters: 0,
  totalTwineKg: 0,
  totalBales: 0,
};

function toNumber(value: number | string | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export function OperatorStats({ operatorId }: OperatorStatsProps) {
  const [stats, setStats] = useState<StatsState>(INITIAL_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setError(null);

      const [fuelRes, twineRes, balesRes] = await Promise.all([
        mobileApiClient.get<FuelStatsResponse>(
          `/api/v1/fuel-logs/stats?operatorId=${operatorId}`,
        ),
        mobileApiClient.get<ConsumableStatsResponse>(
          `/api/v1/consumable-logs/stats?operatorId=${operatorId}&consumableType=twine`,
        ),
        mobileApiClient.get<BaleProductionsResponse>(
          `/api/v1/bale-productions?operatorId=${operatorId}`,
        ),
      ]);

      const totalBales =
        balesRes.data?.reduce(
          (sum: number, rec: { bale_count: number }) => sum + (rec.bale_count ?? 0),
          0,
        ) ?? balesRes.total ?? 0;

      setStats({
        totalFuelLiters: toNumber(fuelRes.totalLiters),
        totalTwineKg: toNumber(twineRes.totalQuantity),
        totalBales,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nu s-au putut încărca statisticile',
      );
    }
  }, [operatorId]);

  useEffect(() => {
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  // Refetch whenever the user navigates back to this tab/screen — ensures
  // the summary reflects the most recent local save + background sync.
  useFocusEffect(
    useCallback(() => {
      void fetchStats();
    }, [fetchStats]),
  );

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.content}>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <StatCard
        label="Motorină totală"
        value={stats.totalFuelLiters}
        unit="L"
      />
      <StatCard
        label="Sfoară totală"
        value={stats.totalTwineKg}
        unit="kg"
      />
      <StatCard
        label="Baloți produși"
        value={stats.totalBales}
        unit="buc"
      />
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
