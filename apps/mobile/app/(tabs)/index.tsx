import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';

export default function HomeScreen() {
  const { isConnected } = useNetworkStatus();
  const { pendingCount, lastSyncAt, triggerSync, syncing } = useSync();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await triggerSync();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>StrawBoss</Text>
        <Text style={styles.subtitle}>Agricultural Logistics</Text>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Connection Status</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#2E7D32' : '#C62828' },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Sync Status</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Pending changes:</Text>
            <Text style={styles.value}>{pendingCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Last sync:</Text>
            <Text style={styles.value}>
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}
            </Text>
          </View>
          {syncing && (
            <Text style={styles.syncingText}>Syncing...</Text>
          )}
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Active Operations</Text>
          <Text style={styles.placeholder}>
            No active operations. Start by scanning a QR code or selecting a trip.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3DED8',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0A5C36',
  },
  subtitle: {
    fontSize: 14,
    color: '#5D4037',
    marginBottom: 8,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#5D4037',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
    color: '#000',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: '#5D4037',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  syncingText: {
    fontSize: 14,
    color: '#0A5C36',
    fontStyle: 'italic',
  },
  placeholder: {
    fontSize: 14,
    color: '#8D6E63',
    fontStyle: 'italic',
  },
});
