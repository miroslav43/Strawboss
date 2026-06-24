import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SignatureCapture } from '../../shared/SignatureCapture';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

interface SignatureStepProps {
  /** Receiver = the depot's contact person (pre-filled, read-only). */
  receiverName: string;
  receiverSignature: string | null;
  onSign: (signature: string) => void;
  onComplete: () => void;
}

/**
 * Delivery signature step — the receiver is the depot's contact person, shown
 * read-only; they only sign (no name entry). The driver already signed at
 * departure (CMR stage 1); only the receiver signature is collected for stage 2.
 */
export function SignatureStep({
  receiverName,
  receiverSignature,
  onSign,
  onComplete,
}: SignatureStepProps) {
  const { t } = useI18n();
  const ready = receiverSignature !== null;

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>{t('delivery.signatureStep.receiverLabel')}</Text>
        <View style={styles.nameBox}>
          <MaterialCommunityIcons name="account" size={18} color={colors.primary} />
          <Text style={styles.nameText}>{receiverName || '—'}</Text>
        </View>
      </View>

      <SignatureCapture label={t('delivery.signatureStep.signatureCapture')} onSave={onSign} />

      {receiverSignature !== null ? (
        <View style={styles.signedRow}>
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
          <Text style={styles.signedText}>{t('delivery.signatureStep.signedConfirmation')}</Text>
        </View>
      ) : (
        <Text style={styles.hint}>{t('delivery.signatureStep.hint')}</Text>
      )}

      <BigButton title={t('delivery.signatureStep.action.continue')} onPress={onComplete} disabled={!ready} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
  nameBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#F9FFF9',
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A5C36',
  },
  signedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  signedText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.success,
  },
  hint: {
    fontSize: 13,
    color: colors.neutral,
    textAlign: 'center',
  },
});
