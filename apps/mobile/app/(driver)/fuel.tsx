import { useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { FuelEntryFlow, FUEL_STEP_TITLE_KEYS } from '@/components/features/fuel/FuelEntryFlow';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';
import { useDriverTruckId } from '@/hooks/useDriverTruckId';
import { useI18n } from '@/lib/i18n';

export default function DriverFuelScreen() {
  const { t } = useI18n();
  const userId = useAuthStore((s) => s.userId);
  // Permanent truck (users.assigned_machine_id) with a fallback to the active
  // trip's truck — fuel_logs.machine_id is NOT NULL server-side, so a null here
  // would make the push fail forever. FuelEntryFlow blocks the save if it stays null.
  const truckId = useDriverTruckId();
  const [stepTitle, setStepTitle] = useState(() => t(FUEL_STEP_TITLE_KEYS.liters));

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title={stepTitle} />
      <View style={styles.body}>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <FuelEntryFlow
            machineId={truckId}
            operatorId={userId}
            onStepChange={setStepTitle}
            onComplete={() => {
              // Stay on tab — reset to first step title
              setStepTitle(t(FUEL_STEP_TITLE_KEYS.liters));
            }}
            onCancel={() => {
              // No-op on tab screen
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
