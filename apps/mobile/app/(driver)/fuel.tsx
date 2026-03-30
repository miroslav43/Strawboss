import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FuelEntryFlow } from '@/components/features/fuel/FuelEntryFlow';
import { useAuthStore } from '@/stores/auth-store';

export default function DriverFuelScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  if (!userId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Se încarcă...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FuelEntryFlow
        machineId={assignedMachineId}
        operatorId={userId}
        onComplete={() => {
          // Stay on tab
        }}
        onCancel={() => {
          // No-op on tab screen
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#5D4037', fontSize: 14 },
});
