import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';

interface ActionCardProps {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onPress: () => void;
  variant?: 'default' | 'active' | 'completed';
}

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  variant = 'default',
}: ActionCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.container,
        variant === 'active' && styles.active,
        variant === 'completed' && styles.completed,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>{icon}</View>
      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            variant === 'active' && styles.activeTitle,
            variant === 'completed' && styles.completedTitle,
          ]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={[
              styles.subtitle,
              variant === 'completed' && styles.completedSubtitle,
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
          color={colors.success}
          accessibilityLabel="Finalizat"
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
    borderRadius: 20,
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
  iconContainer: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 16,
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
