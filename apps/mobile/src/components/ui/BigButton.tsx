import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';

interface BigButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  disabled?: boolean;
  loading?: boolean;
}

const variantStyles: Record<
  NonNullable<BigButtonProps['variant']>,
  { container: ViewStyle; text: TextStyle }
> = {
  primary: {
    container: { backgroundColor: colors.primary },
    text: { color: colors.white },
  },
  secondary: {
    container: { backgroundColor: colors.secondary },
    text: { color: colors.white },
  },
  danger: {
    container: { backgroundColor: colors.danger },
    text: { color: colors.white },
  },
  outline: {
    container: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: colors.primary,
    },
    text: { color: colors.primary },
  },
};

export function BigButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: BigButtonProps) {
  const vs = variantStyles[variant];

  return (
    <TouchableOpacity
      style={[styles.container, vs.container, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'outline' ? colors.primary : colors.white}
          size="small"
        />
      ) : (
        <Text style={[styles.text, vs.text]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const BUTTON_HEIGHT = Math.max(56, scale(60));

const styles = StyleSheet.create({
  container: {
    height: BUTTON_HEIGHT,
    borderRadius: 16,
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
