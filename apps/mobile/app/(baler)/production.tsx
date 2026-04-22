import { View, Text, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductionNumpad } from '@/components/features/production/ProductionNumpad';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { useAuthStore } from '@/stores/auth-store';

export default function BalerProductionScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>Producție</Text>
            <ConnectionStatusBadge />
          </View>
          <Text style={styles.subtitle}>Introdu numărul de baloți</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <ProductionNumpad operatorId={userId} balerId={assignedMachineId} />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  safeArea: { backgroundColor: '#0A5C36' },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 13, color: 'rgba(255, 255, 255, 0.8)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
