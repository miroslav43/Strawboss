import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';

interface ActionCardProps {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onPress: () => void;
  variant?: 'default' | 'active' | 'completed';
  disabled?: boolean;
}

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  variant = 'default',
  disabled = false,
}: ActionCardProps) {
  const { colors: themeColors } = useTheme();
  const { t } = useI18n();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: themeColors.white },
        variant === 'active' && [
          styles.active,
          { backgroundColor: themeColors.primary50, borderColor: themeColors.primary },
        ],
        variant === 'completed' && [styles.completed, { backgroundColor: themeColors.primary50 }],
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: themeColors.surface }]}>{icon}</View>
      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            { color: themeColors.black },
            variant === 'active' && [styles.activeTitle, { color: themeColors.primary }],
            variant === 'completed' && [styles.completedTitle, { color: themeColors.success }],
          ]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={[
              styles.subtitle,
              { color: themeColors.neutral },
              variant === 'completed' && [styles.completedSubtitle, { color: themeColors.success }],
            ]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {variant === 'completed' && (
        <MaterialCommunityIcons
          name="check-circle"
          size={24}
          color={themeColors.success}
          accessibilityLabel={t('common.completed')}
        />
      )}
    </TouchableOpacity>
  );
}

const ICON_SIZE = scale(56);

const styles = StyleSheet.create({
  container: {
    minHeight: scale(80),
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: scale(18),
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  active: {
    borderWidth: 2.5,
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  completed: {
    backgroundColor: colors.primary50,
  },
  disabled: {
    opacity: 0.5,
  },
  iconContainer: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: fontScale(16),
    fontWeight: '600',
    color: colors.black,
  },
  activeTitle: {
    color: colors.primary,
  },
  completedTitle: {
    color: colors.success,
  },
  subtitle: {
    fontSize: fontScale(13),
    color: colors.neutral,
  },
  completedSubtitle: {
    color: colors.success,
  },
});
