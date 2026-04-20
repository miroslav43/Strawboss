import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FuelEntryFlow } from '@/components/features/fuel/FuelEntryFlow';
import { useAuthStore } from '@/stores/auth-store';

export default function DriverFuelScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Combustibil</Text>
        </View>
      </SafeAreaView>
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
  safeArea: { backgroundColor: '#0A5C36' },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
