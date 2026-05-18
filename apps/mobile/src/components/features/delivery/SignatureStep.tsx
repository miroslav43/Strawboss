import { View, Text, TextInput, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SignatureCapture } from '../../shared/SignatureCapture';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface SignatureStepProps {
  receiverName: string;
  onReceiverNameChange: (name: string) => void;
  receiverSignature: string | null;
  onSign: (signature: string) => void;
  onComplete: () => void;
}

/**
 * Delivery signature step — collects the receiver's name and signature.
 * The driver already signed at departure (CMR stage 1); the backend stores
 * only the receiver signature for stage 2, so that is all we collect here.
 */
export function SignatureStep({
  receiverName,
  onReceiverNameChange,
  receiverSignature,
  onSign,
  onComplete,
}: SignatureStepProps) {
  const ready = receiverName.trim().length > 0 && receiverSignature !== null;

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>Numele primitorului</Text>
        <TextInput
          style={styles.input}
          value={receiverName}
          onChangeText={onReceiverNameChange}
          placeholder="ex: Ion Popescu"
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <SignatureCapture label="Semnătura primitorului" onSave={onSign} />

      {receiverSignature !== null ? (
        <View style={styles.signedRow}>
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
          <Text style={styles.signedText}>Semnătură capturată</Text>
        </View>
      ) : (
        <Text style={styles.hint}>Semnați în chenar, apoi apăsați „Confirm”.</Text>
      )}

      <BigButton title="Continuă" onPress={onComplete} disabled={!ready} />
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
  input: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 18,
    fontWeight: '600',
    color: '#0A5C36',
    backgroundColor: '#F9FFF9',
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
