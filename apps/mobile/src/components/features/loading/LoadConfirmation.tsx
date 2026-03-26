import { View, Text, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface LoadConfirmationProps {
  baleCount: number;
  machineCode: string;
  onConfirm: () => void;
  onBack: () => void;
}

export function LoadConfirmation({
  baleCount,
  machineCode,
  onConfirm,
  onBack,
}: LoadConfirmationProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm Loading</Text>

      <View style={styles.summaryCard}>
        <View style={styles.row}>
          <Text style={styles.label}>Machine</Text>
          <Text style={styles.value}>{machineCode}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Bale Count</Text>
          <Text style={styles.valueHighlight}>{baleCount}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <BigButton title="Confirm Loading" onPress={onConfirm} />
        <BigButton title="Back" variant="outline" onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral100,
  },
  label: {
    fontSize: 16,
    color: colors.neutral,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.black,
  },
  valueHighlight: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
});
