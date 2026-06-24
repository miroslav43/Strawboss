import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nativeColors } from '@strawboss/ui-tokens/native';
import { NotificationBell } from './NotificationBell';
import { useI18n } from '@/lib/i18n';

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>{t('shared.appHeader.title')}</Text>
      <View style={styles.right}>
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
