import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

/**
 * FM-1: Discrete badge shown when a trip transition has been applied
 * optimistically but not yet confirmed by the server.
 */
export function PendingTransitionBadge() {
  const { t } = useI18n();
  return (
    <View style={styles.container} accessibilityLabel={t('shared.pendingTransitionBadge.a11y')}>
      <MaterialCommunityIcons name="cloud-upload-outline" size={14} color={colors.warning} />
      <Text style={styles.text}>{t('shared.pendingTransitionBadge.label')}</Text>
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
