import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale, SCREEN_WIDTH } from '@/utils/responsive';
import { useI18n } from '@/lib/i18n';

interface NumericPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  decimal?: boolean;
}

export function NumericPad({ value, onChange, maxLength = 6, decimal = false }: NumericPadProps) {
  const { t } = useI18n();
  const handlePress = (key: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        <Text style={styles.displayText} numberOfLines={1} adjustsFontSizeToFit>
          {value || '0'}
        </Text>
      </View>
      <View style={styles.pad}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.key, (key === 'backspace' || key === 'clear') && styles.actionKey]}
                onPress={() => handlePress(key)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={
                  key === 'backspace'
                    ? t('numericPad.backspaceA11y')
                    : key === 'clear'
                      ? t('numericPad.clearA11y')
                      : t('numericPad.digitA11y', { key })
                }
              >
                <Text
                  style={[
                    styles.keyText,
                    (key === 'backspace' || key === 'clear') && styles.actionKeyText,
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

// Width-aware key size: keep the design size on normal phones, but always
// guarantee 3 keys + gaps + parent padding fit on narrow screens, and cap the
// size so keys aren't oversized on tablets. (~72px non-key horizontal budget:
// up to 24px parent padding each side + two 12px row gaps.)
const KEY_SIZE = Math.min(Math.max(64, scale(72)), Math.floor((SCREEN_WIDTH - 72) / 3), 96);
const KEY_RADIUS = scale(14);

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  display: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  displayText: {
    fontSize: fontScale(48),
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
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_RADIUS,
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
    fontSize: fontScale(28),
    fontWeight: '600',
    color: colors.black,
  },
  actionKeyText: {
    color: colors.neutral,
  },
});
