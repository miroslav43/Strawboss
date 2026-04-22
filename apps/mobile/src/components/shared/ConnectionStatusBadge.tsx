import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { colors } from '@strawboss/ui-tokens';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

interface ConnectionStatusBadgeProps {
  style?: ViewStyle;
}

export function ConnectionStatusBadge({ style }: ConnectionStatusBadgeProps) {
  const { isConnected } = useNetworkStatus();
  const label = isConnected ? 'Online' : 'Offline';
  const dotColor = isConnected ? colors.primary300 : '#FF8A80';

  return (
    <View
      style={[styles.pill, style]}
      accessibilityRole="text"
      accessibilityLabel={isConnected ? 'Conectat la internet' : 'Fără conexiune'}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.white,
    letterSpacing: 0.2,
  },
});
