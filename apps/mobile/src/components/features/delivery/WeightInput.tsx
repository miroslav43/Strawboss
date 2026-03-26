import { View, Text, StyleSheet } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface WeightInputProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
}

export function WeightInput({ value, onChange, onConfirm }: WeightInputProps) {
  const isValid = value.length > 0 && parseFloat(value) > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Enter gross weight (kg)</Text>
      <Text style={styles.value}>{value || '0'} kg</Text>
      <NumericPad value={value} onChange={onChange} maxLength={8} decimal />
      <View style={styles.buttonContainer}>
        <BigButton
          title="Continue"
          onPress={onConfirm}
          disabled={!isValid}
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
    fontSize: 40,
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
