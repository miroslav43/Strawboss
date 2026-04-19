import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors } from '@strawboss/ui-tokens';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons
        name="wifi-off"
        size={18}
        color={colors.white}
        accessibilityLabel="Fără conexiune"
      />
      <Text style={styles.text}>
        Offline — changes will sync when connected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warning,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
});
