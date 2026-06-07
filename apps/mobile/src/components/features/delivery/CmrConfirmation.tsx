import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';

const PRIMARY = '#0A5C36';
const BACKGROUND = '#F3DED8';
const DANGER = '#C62828';
const SUCCESS = '#2E7D32';
const ROW_BORDER = '#D0C8C2';

interface CmrConfirmationProps {
  tripNumber: string;
  baleCount: number;
  grossWeightKg: number;
  tareWeightKg: number;
  netWeightKg: number;
  receiverName: string;
  destinationName: string;
  destinationAddress?: string | null;
  hasSignature: boolean;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
}

interface SummaryRowProps {
  label: string;
  value: string;
  valueStyle?: object;
}

function SummaryRow({ label, value, valueStyle }: SummaryRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

export function CmrConfirmation({
  tripNumber,
  baleCount,
  grossWeightKg,
  tareWeightKg,
  netWeightKg,
  receiverName,
  destinationName,
  destinationAddress,
  hasSignature,
  onConfirm,
  onBack,
  loading,
}: CmrConfirmationProps) {
  const signatureDisplay = hasSignature ? '✓' : '✗';

  // FM-6: countdown before executing the irreversible CMR confirmation
  const [countdownVisible, setCountdownVisible] = useState(false);

  const handleConfirmPress = useCallback(() => {
    setCountdownVisible(true);
  }, []);

  const handleCountdownConfirmed = useCallback(() => {
    setCountdownVisible(false);
    onConfirm();
  }, [onConfirm]);

  const handleCountdownCancel = useCallback(() => {
    setCountdownVisible(false);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirmare CMR</Text>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <SummaryRow label="Cursă" value={tripNumber} />
          <SummaryRow label="Destinație" value={destinationName} />
          {destinationAddress ? <SummaryRow label="Localitate" value={destinationAddress} /> : null}
          <SummaryRow label="Baloți" value={String(baleCount)} />
          <SummaryRow label="Greutate brută" value={`${grossWeightKg} kg`} />
          <SummaryRow label="Tară" value={`${tareWeightKg} kg`} />
          <SummaryRow label="Greutate netă" value={`${netWeightKg} kg`} />
          <SummaryRow label="Primitor" value={receiverName} />
          <SummaryRow
            label="Semnătură"
            value={signatureDisplay}
            valueStyle={hasSignature ? styles.successText : styles.dangerText}
          />
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <BigButton
          title="Confirmă livrare"
          onPress={handleConfirmPress}
          loading={loading}
          disabled={loading}
        />
        <TouchableOpacity onPress={onBack} style={styles.backLink} disabled={loading}>
          <Text style={[styles.backLinkText, loading && styles.backLinkDisabled]}>Înapoi</Text>
        </TouchableOpacity>
      </View>

      {/* FM-6: countdown overlay for irreversible CMR confirmation */}
      <ConfirmCountdown
        visible={countdownVisible}
        actionLabel="Confirmare CMR"
        countdownSeconds={3}
        onConfirmed={handleCountdownConfirmed}
        onCancel={handleCountdownCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: PRIMARY,
    textAlign: 'center',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_BORDER,
  },
  rowLabel: {
    fontSize: 15,
    color: '#555555',
    flex: 1,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
    textAlign: 'right',
  },
  successText: {
    color: SUCCESS,
  },
  dangerText: {
    color: DANGER,
  },
  actions: {
    gap: 12,
  },
  backLink: {
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 16,
    color: PRIMARY,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  backLinkDisabled: {
    opacity: 0.4,
  },
});
