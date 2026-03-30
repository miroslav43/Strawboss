import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface ConsumableConfirmationProps {
  consumableType: 'diesel' | 'twine';
  quantity: number;
  hasPhoto: boolean;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
}

const TYPE_LABELS: Record<'diesel' | 'twine', { label: string; unit: string; icon: string }> = {
  diesel: { label: 'Motorină', unit: 'L', icon: '⛽' },
  twine: { label: 'Sfoară', unit: 'kg', icon: '🧵' },
};

export function ConsumableConfirmation({
  consumableType,
  quantity,
  hasPhoto,
  onConfirm,
  onBack,
  loading,
}: ConsumableConfirmationProps) {
  const { label, unit, icon } = TYPE_LABELS[consumableType];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirmare Consumabil</Text>

      <View style={styles.summaryCard}>
        <View style={styles.row}>
          <Text style={styles.label}>Tip</Text>
          <View style={styles.typeRow}>
            <Text style={styles.icon}>{icon}</Text>
            <Text style={styles.value}>{label}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Cantitate</Text>
          <View style={styles.quantityRow}>
            <Text style={styles.valueHighlight}>{quantity}</Text>
            <Text style={styles.unit}>{unit}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Bon fiscal</Text>
          <Text style={[styles.value, hasPhoto ? styles.photoPresent : styles.photoAbsent]}>
            {hasPhoto ? 'Adăugat' : 'Nu'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <BigButton title="Salvează" onPress={onConfirm} loading={loading} />
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>Înapoi</Text>
        </TouchableOpacity>
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
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
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
  unit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
  icon: {
    fontSize: 20,
  },
  photoPresent: {
    color: colors.primary,
  },
  photoAbsent: {
    color: colors.neutral,
  },
  actions: {
    gap: 12,
    marginTop: 'auto',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
