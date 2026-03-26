import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

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
        <Text style={styles.checkmark}>{'\u2713'}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  active: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  completed: {
    backgroundColor: '#E8F5E9',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
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
    fontSize: 13,
    color: colors.neutral,
  },
  completedSubtitle: {
    color: colors.success,
  },
  checkmark: {
    fontSize: 24,
    color: colors.success,
    fontWeight: '700',
  },
});
