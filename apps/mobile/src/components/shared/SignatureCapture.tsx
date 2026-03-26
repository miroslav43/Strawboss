import { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { BigButton } from '../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface SignatureCaptureProps {
  onSave: (signature: string) => void;
  label?: string;
}

export function SignatureCapture({ onSave, label }: SignatureCaptureProps) {
  const ref = useRef<SignatureViewRef>(null);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.canvasContainer}>
        <SignatureScreen
          ref={ref}
          onOK={(sig: string) => onSave(sig)}
          webStyle={`.m-signature-pad { border: none; box-shadow: none; } .m-signature-pad--body { border: none; }`}
        />
      </View>
      <View style={styles.actions}>
        <View style={styles.actionButton}>
          <BigButton
            title="Clear"
            variant="outline"
            onPress={() => ref.current?.clearSignature()}
          />
        </View>
        <View style={styles.actionButton}>
          <BigButton
            title="Confirm"
            onPress={() => ref.current?.readSignature()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
  canvasContainer: {
    height: 200,
    borderWidth: 1,
    borderColor: colors.neutral200,
    borderRadius: 8,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
});
