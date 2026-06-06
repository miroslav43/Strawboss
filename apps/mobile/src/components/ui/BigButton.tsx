import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import { radii } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';
import { useTheme } from '@/lib/theme';

interface BigButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  disabled?: boolean;
  loading?: boolean;
}

export function BigButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: BigButtonProps) {
  const { colors: themeColors } = useTheme();

  // In high-contrast mode, outline variant gets a thicker, darker border so it
  // remains visible on the white background without fill.
  const outlineStyle: ViewStyle =
    variant === 'outline' ? { borderColor: themeColors.primary, borderWidth: 2 } : {};

  const containerBg: ViewStyle = (() => {
    switch (variant) {
      case 'primary':
        return { backgroundColor: themeColors.primary };
      case 'secondary':
        return { backgroundColor: themeColors.secondary };
      case 'danger':
        return { backgroundColor: themeColors.danger };
      case 'outline':
        return { backgroundColor: 'transparent', ...outlineStyle };
    }
  })();

  const textColor = variant === 'outline' ? themeColors.primary : themeColors.white;

  return (
    <TouchableOpacity
      style={[styles.container, containerBg, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// Floor at 56 for an accessible touch target; cap at 72 so the button isn't
// oversized on tablets / large-font devices.
const BUTTON_HEIGHT = Math.min(72, Math.max(56, scale(60)));

const styles = StyleSheet.create({
  container: {
    height: BUTTON_HEIGHT,
    borderRadius: radii.lg,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  text: {
    fontSize: fontScale(17),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.5,
  },
});
