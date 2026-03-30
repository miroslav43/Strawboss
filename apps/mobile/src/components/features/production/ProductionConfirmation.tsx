import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface ProductionConfirmationProps {
  parcelName: string;
  baleCount: number;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
}

export function ProductionConfirmation({
  parcelName,
  baleCount,
  onConfirm,
  onBack,
  loading,
}: ProductionConfirmationProps) {
  const now = new Date();
  const formattedDate = now.toLocaleDateString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const formattedTime = now.toLocaleTimeString('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirmare Producție</Text>

      <View style={styles.summaryCard}>
        <View style={styles.row}>
          <Text style={styles.label}>Parcelă</Text>
          <Text style={styles.value}>{parcelName}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Baloți produși</Text>
          <Text style={styles.valueHighlight}>{baleCount}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Data</Text>
          <Text style={styles.value}>{formattedDate}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Ora</Text>
          <Text style={styles.value}>{formattedTime}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <BigButton
          title="Parcelă terminată"
          onPress={onConfirm}
          loading={loading}
        />
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
