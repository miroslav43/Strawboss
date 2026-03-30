import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';

const PRIMARY = '#0A5C36';
const BACKGROUND = '#F3DED8';

interface DeterioratedBalesInputProps {
  baleCount: number;
  onBaleCountChange: (count: number) => void;
  totalBales: number;
  onNext: () => void;
  onBack: () => void;
}

export function DeterioratedBalesInput({
  baleCount,
  onBaleCountChange,
  totalBales,
  onNext,
  onBack,
}: DeterioratedBalesInputProps) {
  const displayValue = baleCount === 0 ? '' : String(baleCount);

  const handleChange = (raw: string) => {
    if (raw === '') {
      onBaleCountChange(0);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(parsed, totalBales);
    onBaleCountChange(clamped);
  };

  const handleSkip = () => {
    onBaleCountChange(0);
    onNext();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Baloți deteriorați</Text>
      <Text style={styles.subtitle}>
        Câți baloți sunt în stare proastă? (opțional, implicit 0)
      </Text>

      <NumericPad
        value={displayValue}
        onChange={handleChange}
        maxLength={String(totalBales).length + 1}
      />

      <Text style={styles.context}>
        {'Din '}
        <Text style={styles.contextBold}>{totalBales}</Text>
        {' baloți total'}
      </Text>

      <View style={styles.buttons}>
        <BigButton
          title="Niciunul (0)"
          variant="outline"
          onPress={handleSkip}
        />
        <BigButton title="Continuă" onPress={onNext} />
      </View>

      <TouchableOpacity onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkText}>Înapoi</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
    padding: 24,
    gap: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: PRIMARY,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
    lineHeight: 20,
  },
  context: {
    fontSize: 15,
    color: '#555555',
    textAlign: 'center',
  },
  contextBold: {
    fontWeight: '700',
    color: PRIMARY,
  },
  buttons: {
    width: '100%',
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
});
