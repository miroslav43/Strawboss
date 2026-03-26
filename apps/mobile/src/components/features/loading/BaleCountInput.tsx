import { View, Text, StyleSheet } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface BaleCountInputProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
}

export function BaleCountInput({
  value,
  onChange,
  onConfirm,
}: BaleCountInputProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Enter bale count</Text>
      <Text style={styles.value}>{value || '0'}</Text>
      <NumericPad value={value} onChange={onChange} maxLength={4} />
      <View style={styles.buttonContainer}>
        <BigButton
          title="Continue"
          onPress={onConfirm}
          disabled={!value || value === '0'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 8,
    alignItems: 'center',
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.neutral,
    textAlign: 'center',
  },
  value: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
    marginVertical: 8,
  },
  buttonContainer: {
    width: '100%',
    marginTop: 16,
  },
});
