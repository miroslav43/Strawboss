import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';
import { getDatabase } from '@/lib/storage';
import { SyncQueueRepo, type SyncQueueEntry } from '@/db/sync-queue-repo';

export default function SyncScreen() {
  const { isConnected } = useNetworkStatus();
  const { syncing, lastSyncAt, pendingCount, errors, triggerSync } = useSync();
  const [failedEntries, setFailedEntries] = useState<SyncQueueEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadFailedEntries = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      const entries = await repo.getFailedEntries();
      setFailedEntries(entries);
    } catch (err) {
      console.error('Failed to load failed entries:', err);
    }
  }, []);

  useEffect(() => {
    void loadFailedEntries();
  }, [loadFailedEntries, syncing]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFailedEntries();
    setRefreshing(false);
  };

  const handleSync = async () => {
    await triggerSync();
    await loadFailedEntries();
  };

  const handleRetry = async (id: number) => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      await repo.retry(id);
      await triggerSync();
      await loadFailedEntries();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Sync Status</Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Network:</Text>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: isConnected ? '#2E7D32' : '#C62828' },
                ]}
              />
              <Text style={styles.value}>
                {isConnected ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.label}>Pending changes:</Text>
            <Text style={[styles.value, pendingCount > 0 && styles.valuePending]}>
              {pendingCount}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.label}>Last sync:</Text>
            <Text style={styles.value}>
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.syncButton,
            (!isConnected || syncing) && styles.syncButtonDisabled,
          ]}
          onPress={handleSync}
          disabled={!isConnected || syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.syncButtonText}>
              {isConnected ? 'Sync Now' : 'No Connection'}
            </Text>
          )}
        </TouchableOpacity>

        {errors.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent Errors</Text>
            {errors.map((error, i) => (
              <Text key={i} style={styles.errorText}>
                {error}
              </Text>
            ))}
          </View>
        )}

        {failedEntries.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Failed Entries ({failedEntries.length})
            </Text>
            {failedEntries.map((entry) => (
              <View key={entry.id} style={styles.failedEntry}>
                <View style={styles.failedEntryInfo}>
                  <Text style={styles.failedEntryType}>
                    {entry.entity_type} / {entry.action}
                  </Text>
                  <Text style={styles.failedEntryError} numberOfLines={2}>
                    {entry.last_error ?? 'Unknown error'}
                  </Text>
                  <Text style={styles.failedEntryMeta}>
                    Retries: {entry.retry_count}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => handleRetry(entry.id)}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
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
    fontSize: 24,
    fontWeight: '700',
    color: '#0A5C36',
  },
  card: {
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  valuePending: {
    color: '#B7791F',
  },
  syncButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 13,
    color: '#C62828',
  },
  failedEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EFEBE9',
  },
  failedEntryInfo: {
    flex: 1,
    gap: 2,
  },
  failedEntryType: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5D4037',
  },
  failedEntryError: {
    fontSize: 12,
    color: '#C62828',
  },
  failedEntryMeta: {
    fontSize: 11,
    color: '#8D6E63',
  },
  retryButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginLeft: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
