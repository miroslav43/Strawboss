import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { ConsumableFlow } from '@/components/features/consumables/ConsumableFlow';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';

export default function BalerConsumablesScreen() {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const userId = useAuthStore((s) => s.userId);

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Consumabile" />
      <View style={styles.body}>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <ConsumableFlow
            machineId={assignedMachineId}
            operatorId={userId}
            onComplete={() => {
              // Stay on tab — user can record more consumables
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
