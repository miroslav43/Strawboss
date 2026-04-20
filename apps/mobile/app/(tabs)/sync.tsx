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
import { mobileLogger } from '@/lib/logger';

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
      mobileLogger.error('Failed to load failed sync queue entries', {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
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
      mobileLogger.error('Sync queue retry failed', {
        entryId: id,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Sincronizare</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Rețea:</Text>
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
            <Text style={styles.label}>Modificări în așteptare:</Text>
            <Text style={[styles.value, pendingCount > 0 && styles.valuePending]}>
              {pendingCount}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.label}>Ultima sincronizare:</Text>
            <Text style={styles.value}>
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString('ro-RO') : 'Niciodată'}
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
              {isConnected ? 'Sincronizează acum' : 'Fără conexiune'}
            </Text>
          )}
        </TouchableOpacity>

        {errors.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Erori recente</Text>
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
              Intrări eșuate ({failedEntries.length})
            </Text>
            {failedEntries.map((entry) => (
              <View key={entry.id} style={styles.failedEntry}>
                <View style={styles.failedEntryInfo}>
                  <Text style={styles.failedEntryType}>
                    {entry.entity_type} / {entry.action}
                  </Text>
                  <Text style={styles.failedEntryError} numberOfLines={2}>
                    {entry.last_error ?? 'Eroare necunoscută'}
                  </Text>
                  <Text style={styles.failedEntryMeta}>
                    Reîncercări: {entry.retry_count}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => handleRetry(entry.id)}
                >
                  <Text style={styles.retryButtonText}>Reîncearcă</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 14, color: '#5D4037' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  valuePending: { color: '#B7791F' },
  syncButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 16,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  errorText: { fontSize: 13, color: '#C62828' },
  failedEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EFEBE9',
  },
  failedEntryInfo: { flex: 1, gap: 2 },
  failedEntryType: { fontSize: 13, fontWeight: '600', color: '#5D4037' },
  failedEntryError: { fontSize: 12, color: '#C62828' },
  failedEntryMeta: { fontSize: 11, color: '#8D6E63' },
  retryButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginLeft: 8,
  },
  retryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
