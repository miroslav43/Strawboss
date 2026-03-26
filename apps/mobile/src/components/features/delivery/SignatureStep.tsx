import { View, Text, StyleSheet } from 'react-native';
import { SignatureCapture } from '../../shared/SignatureCapture';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

type SignatureRole = 'driver' | 'receiver' | 'witness';

interface Signatures {
  driver?: string;
  receiver?: string;
  witness?: string;
}

interface SignatureStepProps {
  signatures: Signatures;
  onSign: (role: SignatureRole, signature: string) => void;
  onComplete: () => void;
}

const ROLE_LABELS: Record<SignatureRole, string> = {
  driver: "Driver's Signature",
  receiver: "Receiver's Signature",
  witness: "Witness Signature",
};

export function SignatureStep({
  signatures,
  onSign,
  onComplete,
}: SignatureStepProps) {
  const currentRole: SignatureRole = !signatures.driver
    ? 'driver'
    : !signatures.receiver
      ? 'receiver'
      : 'witness';

  const allSigned = !!(
    signatures.driver &&
    signatures.receiver &&
    signatures.witness
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Signatures</Text>

      <View style={styles.progress}>
        {(['driver', 'receiver', 'witness'] as const).map((role) => (
          <View key={role} style={styles.progressItem}>
            <View
              style={[
                styles.progressDot,
                signatures[role] ? styles.progressDotDone : undefined,
                role === currentRole && !allSigned
                  ? styles.progressDotActive
                  : undefined,
              ]}
            >
              {signatures[role] ? (
                <Text style={styles.checkText}>{'\u2713'}</Text>
              ) : null}
            </View>
            <Text
              style={[
                styles.progressLabel,
                role === currentRole && !allSigned
                  ? styles.progressLabelActive
                  : undefined,
              ]}
            >
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </Text>
          </View>
        ))}
      </View>

      {!allSigned ? (
        <SignatureCapture
          label={ROLE_LABELS[currentRole]}
          onSave={(sig) => onSign(currentRole, sig)}
        />
      ) : (
        <View style={styles.completeSection}>
          <Text style={styles.allSignedText}>All signatures collected</Text>
          <BigButton title="Complete Delivery" onPress={onComplete} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  progressItem: {
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.neutral200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressDotDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  progressDotActive: {
    borderColor: colors.primary,
    borderWidth: 3,
  },
  checkText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  progressLabel: {
    fontSize: 12,
    color: colors.neutral,
  },
  progressLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  completeSection: {
    flex: 1,
    justifyContent: 'center',
    gap: 24,
  },
  allSignedText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.success,
    textAlign: 'center',
  },
});
