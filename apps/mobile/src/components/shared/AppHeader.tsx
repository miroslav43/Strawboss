import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nativeColors } from '@strawboss/ui-tokens/native';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { NotificationBell } from './NotificationBell';

export function AppHeader() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>Strawboss</Text>
      <View style={styles.right}>
        <ConnectionStatusBadge />
        <NotificationBell />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: nativeColors.primary,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
