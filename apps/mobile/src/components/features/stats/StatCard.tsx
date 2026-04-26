import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';

interface StatCardProps {
  label: string;
  value: string | number;
  unit: string;
  subtitle?: string;
}

export function StatCard({ label, value, unit, subtitle }: StatCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      {subtitle !== undefined && (
        <Text style={styles.subtitle}>{subtitle}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: scale(16),
    padding: scale(20),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    gap: 4,
  },
  label: {
    fontSize: fontScale(14),
    fontWeight: '500',
    color: colors.neutral,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: fontScale(36),
    fontWeight: '700',
    color: colors.primary,
  },
  unit: {
    fontSize: fontScale(16),
    fontWeight: '500',
    color: colors.neutral,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: fontScale(12),
    color: colors.neutral,
    marginTop: 2,
  },
});
