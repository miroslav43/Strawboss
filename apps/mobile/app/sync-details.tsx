import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { useSyncQueueStatus } from '@/hooks/useSyncQueueStatus';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import type { SyncQueueEntry } from '@/db/sync-queue-repo';

/** Human-readable Romanian labels for entity types. */
const ENTITY_LABELS: Record<string, string> = {
  trips: 'Cursă',
  bale_loads: 'Încărcare baloți',
  bale_productions: 'Producție baloți',
  fuel_logs: 'Alimentare combustibil',
  consumable_logs: 'Consumabil',
  operations: 'Operațiune',
  task_assignments: 'Sarcină',
};

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function actionLabel(action: string): string {
  switch (action) {
    case 'create':
      return 'creare';
    case 'update':
      return 'actualizare';
    case 'delete':
      return 'ștergere';
    case 'transition':
      return 'tranziție';
    default:
      return action;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface EntryCardProps {
  entry: SyncQueueEntry;
  onRetry: (id: number) => void;
  retrying: boolean;
}

function EntryCard({ entry, onRetry, retrying }: EntryCardProps) {
  const isFailed = entry.status === 'failed';
  const statusColor = isFailed ? colors.danger : colors.warning;
  const statusLabel = isFailed ? 'eșuat' : 'în așteptare';

  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.entryTitle}>
          {entityLabel(entry.entity_type)} — {actionLabel(entry.action)}
        </Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
      </View>

      <View style={styles.entryMeta}>
        <Text style={styles.metaText}>{formatDate(entry.created_at)}</Text>
        {entry.retry_count > 0 && (
          <Text style={styles.metaText}>Reîncercări: {entry.retry_count}</Text>
        )}
      </View>

      {isFailed && entry.last_error ? (
        <Text style={styles.errorText} numberOfLines={3}>
          {entry.last_error}
        </Text>
      ) : null}

      {isFailed && (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => onRetry(entry.id)}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel="Reîncearcă această înregistrare"
        >
          {retrying ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.retryButtonText}>Reîncearcă</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function SyncDetailsScreen() {
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const {
    syncing,
    lastSyncAt,
    pendingCount,
    failedCount,
    allEntries,
    triggerSync,
    retryFailedAndSync,
    retryEntry,
    refresh,
  } = useSyncQueueStatus();

  const handleRetryEntry = useCallback(
    async (id: number) => {
      await retryEntry(id);
    },
    [retryEntry],
  );

  const handleRetryAll = useCallback(async () => {
    await retryFailedAndSync();
  }, [retryFailedAndSync]);

  const handleSyncNow = useCallback(async () => {
    await triggerSync();
  }, [triggerSync]);

  const totalUnsent = pendingCount;
  const isEmpty = allEntries.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: SyncQueueEntry }) => (
      <EntryCard entry={item} onRetry={handleRetryEntry} retrying={syncing} />
    ),
    [handleRetryEntry, syncing],
  );

  const keyExtractor = useCallback((item: SyncQueueEntry) => String(item.id), []);

  return (
    <View style={styles.outerContainer}>
      {/* Header */}
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Înapoi"
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.title}>Date în așteptare</Text>
          <TouchableOpacity
            onPress={refresh}
            style={styles.refreshButton}
            accessibilityRole="button"
            accessibilityLabel="Reîmprospătează"
          >
            <MaterialCommunityIcons name="refresh" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Body */}
      <View style={styles.body}>
        {/* Status summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Rețea:</Text>
            <View style={styles.summaryValueRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: isConnected ? colors.success : colors.danger },
                ]}
              />
              <Text style={styles.summaryValue}>{isConnected ? 'Online' : 'Offline'}</Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>În așteptare:</Text>
            <Text style={[styles.summaryValue, totalUnsent > 0 && styles.valuePending]}>
              {totalUnsent}
            </Text>
          </View>

          {failedCount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Eșuate:</Text>
              <Text style={[styles.summaryValue, styles.valueFailed]}>{failedCount}</Text>
            </View>
          )}

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ultima sincronizare:</Text>
            <Text style={styles.summaryValue}>
              {lastSyncAt ? formatDate(lastSyncAt) : 'Niciodată'}
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          {failedCount > 0 && (
            <TouchableOpacity
              style={[styles.actionButton, styles.retryAllButton, syncing && styles.buttonDisabled]}
              onPress={handleRetryAll}
              disabled={syncing || !isConnected}
              accessibilityRole="button"
              accessibilityLabel="Reîncearcă toate înregistrările eșuate"
            >
              {syncing ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.actionButtonText}>Reîncearcă toate</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.syncNowButton,
              (syncing || !isConnected) && styles.buttonDisabled,
            ]}
            onPress={handleSyncNow}
            disabled={syncing || !isConnected}
            accessibilityRole="button"
            accessibilityLabel={isConnected ? 'Sincronizează acum' : 'Fără conexiune'}
          >
            {syncing ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.actionButtonText}>
                {isConnected ? 'Sincronizează acum' : 'Fără conexiune'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Entry list */}
        <FlatList
          data={allEntries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, isEmpty && styles.listEmpty]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={56}
                color={colors.success}
              />
              <Text style={styles.emptyTitle}>Totul este sincronizat</Text>
              <Text style={styles.emptySubtitle}>
                Nu există înregistrări în așteptare sau eșuate.
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.primary },
  safeArea: { backgroundColor: colors.primary },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 8,
  },
  backButton: { padding: 4 },
  refreshButton: { padding: 4 },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  summaryLabel: { fontSize: 14, color: colors.neutral },
  summaryValue: { fontSize: 14, fontWeight: '600', color: colors.black },
  valuePending: { color: colors.warning },
  valueFailed: { color: colors.danger },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncNowButton: { backgroundColor: colors.primary },
  retryAllButton: { backgroundColor: colors.warning },
  buttonDisabled: { opacity: 0.5 },
  actionButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  listContent: { paddingBottom: 24, gap: 10 },
  listEmpty: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral },
  emptySubtitle: { fontSize: 14, color: colors.tertiary, textAlign: 'center' },
  entryCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    gap: 6,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  entryTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral },
  statusLabel: { fontSize: 12, color: colors.tertiary, fontWeight: '500' },
  entryMeta: { flexDirection: 'row', gap: 16, paddingLeft: 16 },
  metaText: { fontSize: 12, color: colors.tertiary },
  errorText: { fontSize: 12, color: colors.danger, paddingLeft: 16 },
  retryButton: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  retryButtonText: { color: colors.white, fontSize: 13, fontWeight: '600' },
});
