import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';

/**
 * FM-1: Discrete badge shown when a trip transition has been applied
 * optimistically but not yet confirmed by the server.
 */
export function PendingTransitionBadge() {
  return (
    <View style={styles.container} accessibilityLabel="Tranziție în așteptare de sincronizare">
      <MaterialCommunityIcons name="cloud-upload-outline" size={14} color={colors.warning} />
      <Text style={styles.text}>va fi trimis la reconectare</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFF8E1',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.warning,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
});
