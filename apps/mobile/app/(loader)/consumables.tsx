import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { ConsumableFlow } from '@/components/features/consumables/ConsumableFlow';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';

export default function LoaderConsumablesScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Motorină">
        <Text style={styles.subtitle}>Înregistrează alimentare combustibil</Text>
      </ScreenHeader>
      <View style={styles.body}>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <ConsumableFlow
            machineId={assignedMachineId}
            operatorId={userId}
            lockType="diesel"
            onComplete={() => {
              // Stay on tab
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
