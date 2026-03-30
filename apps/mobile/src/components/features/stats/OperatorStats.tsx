import { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Text,
  StyleSheet,
} from 'react-native';
import { StatCard } from './StatCard';
import { mobileApiClient } from '@/lib/api-client';
import { colors } from '@strawboss/ui-tokens';

interface OperatorStatsProps {
  operatorId: string;
}

interface FuelStatsResponse {
  total_liters?: number;
}

interface TwineStatsResponse {
  total_kg?: number;
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

export function OperatorStats({ operatorId }: OperatorStatsProps) {
  const [stats, setStats] = useState<StatsState>(INITIAL_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setError(null);

      const [fuelRes, twineRes, balesRes] = await Promise.all([
        mobileApiClient.get<FuelStatsResponse>(
          `/api/v1/fuel-logs/stats?operatorId=${operatorId}`,
        ),
        mobileApiClient.get<TwineStatsResponse>(
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
        totalFuelLiters: fuelRes.total_liters ?? 0,
        totalTwineKg: twineRes.total_kg ?? 0,
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  }, [fetchStats]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
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
