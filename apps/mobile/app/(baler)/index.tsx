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
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { TaskList } from '@/components/shared/TaskList';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { useProfile } from '@/hooks/useProfile';
import { useMyTasks } from '@/hooks/useMyTasks';

export default function BalerHomeScreen() {
  const { profile, isLoading } = useProfile();
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchTasks();
    setRefreshing(false);
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OfflineBanner />
        <View style={styles.headerSection}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>Balotieră</Text>
            <ConnectionStatusBadge />
          </View>
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" style={styles.loader} />
          ) : (
            <Text style={styles.subtitle}>
              {profile?.fullName ?? 'Operator'}
            </Text>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <TaskList tasks={tasks} role="baler_operator" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  loader: {
    alignSelf: 'flex-start',
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 16,
    gap: 16,
  },
});
