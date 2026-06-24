import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { FuelEntryFlow } from '@/components/features/fuel/FuelEntryFlow';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';
import { useI18n } from '@/lib/i18n';

export default function LoaderConsumablesScreen() {
  const { t } = useI18n();
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title={t('loader.consumables.screenTitle')}>
        <Text style={styles.subtitle}>{t('loader.consumables.subtitle')}</Text>
      </ScreenHeader>
      <View style={styles.body}>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <FuelEntryFlow
            machineId={assignedMachineId}
            operatorId={userId}
            onComplete={() => {
              // Stay on tab
            }}
            onCancel={() => {
              // Tab screen — nothing to cancel back to; reset handled internally.
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
