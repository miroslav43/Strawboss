import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BigButton } from '@/components/ui/BigButton';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { TaskList } from '@/components/shared/TaskList';
import { useProfile } from '@/hooks/useProfile';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useMyTasks } from '@/hooks/useMyTasks';

export default function BalerHomeScreen() {
  const { profile, isLoading } = useProfile();
  const { isConnected } = useNetworkStatus();
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchTasks();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.title}>Balotieră</Text>
        {isLoading ? (
          <ActivityIndicator color="#0A5C36" style={styles.loader} />
        ) : (
          <Text style={styles.subtitle}>
            {profile?.fullName ?? 'Operator'}
          </Text>
        )}

        <TaskList tasks={tasks} role="baler_operator" />

        <View style={styles.buttonGroup}>
          <BigButton
            title="🌾  Înregistrează producție"
            onPress={() => router.push('/baler-ops/production')}
          />
          <BigButton
            title="⛽  Notează consumabile"
            onPress={() => router.push('/(baler)/consumables')}
            variant="secondary"
          />
          <BigButton
            title="📊  Starea mea"
            onPress={() => router.push('/(baler)/stats')}
            variant="outline"
          />
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Conexiune</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#2E7D32' : '#C62828' },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Online' : 'Offline — datele vor fi sincronizate ulterior'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#0A5C36' },
  subtitle: { fontSize: 14, color: '#5D4037', marginBottom: 8 },
  loader: { marginBottom: 8 },
  buttonGroup: { gap: 12, marginTop: 8 },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 13, color: '#374151', flex: 1 },
});
