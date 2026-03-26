import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors } from '@strawboss/ui-tokens';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        Offline — changes will sync when connected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warning,
    padding: 8,
    alignItems: 'center',
  },
  text: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 13,
  },
});
