import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';

const PRIMARY = '#0A5C36';
const BACKGROUND = '#F3DED8';
const DANGER = '#C62828';
const SUCCESS = '#2E7D32';
const ROW_BORDER = '#D0C8C2';

interface CmrConfirmationProps {
  tripNumber: string;
  baleCount: number;
  deterioratedBales: number;
  netWeightKg: number;
  receiverName: string;
  destinationName: string;
  hasTicketPhoto: boolean;
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
  deterioratedBales,
  netWeightKg,
  receiverName,
  destinationName,
  hasTicketPhoto,
  hasSignature,
  onConfirm,
  onBack,
  loading,
}: CmrConfirmationProps) {
  const ticketDisplay = hasTicketPhoto ? '\u2713' : '\u2717';
  const signatureDisplay = hasSignature ? '\u2713' : '\u2717';

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
          <SummaryRow label="Baloți" value={String(baleCount)} />
          <SummaryRow
            label="Baloți deteriorați"
            value={String(deterioratedBales)}
            valueStyle={deterioratedBales > 0 ? styles.dangerText : undefined}
          />
          <SummaryRow label="Greutate netă" value={`${netWeightKg} kg`} />
          <SummaryRow label="Client" value={receiverName} />
          <SummaryRow
            label="Poză tichet"
            value={ticketDisplay}
            valueStyle={hasTicketPhoto ? styles.successText : styles.dangerText}
          />
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
          onPress={onConfirm}
          loading={loading}
          disabled={loading}
        />
        <TouchableOpacity onPress={onBack} style={styles.backLink} disabled={loading}>
          <Text style={[styles.backLinkText, loading && styles.backLinkDisabled]}>
            Înapoi
          </Text>
        </TouchableOpacity>
      </View>
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
