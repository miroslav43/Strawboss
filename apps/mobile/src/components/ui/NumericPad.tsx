import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

interface NumericPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  decimal?: boolean;
}

export function NumericPad({
  value,
  onChange,
  maxLength = 6,
  decimal = false,
}: NumericPadProps) {
  const handlePress = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      onChange('');
      return;
    }
    if (key === '.' && (!decimal || value.includes('.'))) {
      return;
    }
    if (value.length >= maxLength) return;
    onChange(value + key);
  };

  const bottomLeft = decimal ? '.' : 'clear';
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [bottomLeft, '0', 'backspace'],
  ];

  return (
    <View style={styles.container}>
      <View style={styles.display}>
        <Text style={styles.displayText}>{value || '0'}</Text>
      </View>
      <View style={styles.pad}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.key,
                  (key === 'backspace' || key === 'clear') && styles.actionKey,
                ]}
                onPress={() => handlePress(key)}
                activeOpacity={0.6}
              >
                <Text
                  style={[
                    styles.keyText,
                    (key === 'backspace' || key === 'clear') &&
                      styles.actionKeyText,
                  ]}
                >
                  {key === 'backspace' ? '\u232B' : key === 'clear' ? 'C' : key}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  display: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  displayText: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
  },
  pad: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 3,
  },
  actionKey: {
    backgroundColor: colors.surface,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.black,
  },
  actionKeyText: {
    color: colors.neutral,
  },
});
