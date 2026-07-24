import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { BigButton } from '../../ui/BigButton';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { useI18n } from '@/lib/i18n';

const PRIMARY = '#0A5C36';
const BACKGROUND = '#F3DED8';
const ROW_BORDER = '#D0C8C2';

interface CmrConfirmationProps {
  tripNumber: string;
  baleCount: number;
  grossWeightKg: number;
  tareWeightKg: number;
  netWeightKg: number;
  /** Depot had no working scale — the driver delivered without weighing. */
  scaleBroken?: boolean;
  receiverName: string;
  destinationName: string;
  destinationAddress?: string | null;
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
  scaleBroken = false,
  receiverName,
  destinationName,
  destinationAddress,
  onConfirm,
  onBack,
  loading,
}: CmrConfirmationProps) {
  const { t } = useI18n();
  const weightDisplay = (kg: number) =>
    scaleBroken ? t('delivery.cmr.row.notWeighed') : `${kg} kg`;

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
      <Text style={styles.title}>{t('delivery.cmr.title')}</Text>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <SummaryRow label={t('delivery.cmr.row.trip')} value={tripNumber} />
          <SummaryRow label={t('delivery.cmr.row.destination')} value={destinationName} />
          {destinationAddress ? (
            <SummaryRow label={t('delivery.cmr.row.locality')} value={destinationAddress} />
          ) : null}
          <SummaryRow label={t('delivery.cmr.row.bales')} value={String(baleCount)} />
          <SummaryRow
            label={t('delivery.cmr.row.grossWeight')}
            value={weightDisplay(grossWeightKg)}
          />
          <SummaryRow label={t('delivery.cmr.row.tare')} value={weightDisplay(tareWeightKg)} />
          <SummaryRow label={t('delivery.cmr.row.netWeight')} value={weightDisplay(netWeightKg)} />
          <SummaryRow label={t('delivery.cmr.row.receiver')} value={receiverName} />
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <BigButton
          title={t('delivery.cmr.action.confirm')}
          onPress={handleConfirmPress}
          loading={loading}
          disabled={loading}
        />
        <TouchableOpacity onPress={onBack} style={styles.backLink} disabled={loading}>
          <Text style={[styles.backLinkText, loading && styles.backLinkDisabled]}>
            {t('delivery.cmr.action.back')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* FM-6: countdown overlay for irreversible CMR confirmation */}
      <ConfirmCountdown
        visible={countdownVisible}
        actionLabel={t('delivery.cmr.countdownActionLabel')}
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
