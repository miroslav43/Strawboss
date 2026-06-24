import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();
  const { t } = useI18n();

  if (isConnected) return null;

  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons
        name="wifi-off"
        size={18}
        color={colors.white}
        accessibilityLabel={t('shared.offlineBanner.noConnection')}
      />
      <Text style={styles.text}>{t('shared.offlineBanner.message')}</Text>
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
