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
import { useI18n } from '@/lib/i18n';
import {
  FEATURE_DISABLED_ERROR,
  SEASON_CLOSED_ERROR,
  TERMINAL_REJECTION_ERROR,
} from '@/sync/push';

const ENTITY_KEY: Record<string, string> = {
  trips: 'syncDetails.entityLabel.trips',
  bale_loads: 'syncDetails.entityLabel.baleLoads',
  bale_productions: 'syncDetails.entityLabel.baleProductions',
  fuel_logs: 'syncDetails.entityLabel.fuelLogs',
  consumable_logs: 'syncDetails.entityLabel.consumableLogs',
  operations: 'syncDetails.entityLabel.operations',
  task_assignments: 'syncDetails.entityLabel.taskAssignments',
};

const ACTION_KEY: Record<string, string> = {
  create: 'syncDetails.actionLabel.create',
  update: 'syncDetails.actionLabel.update',
  delete: 'syncDetails.actionLabel.delete',
  transition: 'syncDetails.actionLabel.transition',
};

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
  t: (key: string, params?: Record<string, string | number>) => string;
}

function EntryCard({ entry, onRetry, retrying, t }: EntryCardProps) {
  const isFailed = entry.status === 'failed';
  const statusColor = isFailed ? colors.danger : colors.warning;
  const statusLabel = isFailed ? t('syncDetails.statusFailed') : t('syncDetails.statusPending');
  const entityKey = ENTITY_KEY[entry.entity_type];
  const actionKey = ACTION_KEY[entry.action];
  const entityLabel = entityKey ? t(entityKey) : entry.entity_type;
  const actionLabel = actionKey ? t(actionKey) : entry.action;

  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.entryTitle} numberOfLines={1}>
          {entityLabel} — {actionLabel}
        </Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
      </View>

      <View style={styles.entryMeta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {formatDate(entry.created_at)}
        </Text>
        {entry.retry_count > 0 && (
          <Text style={styles.metaText} numberOfLines={1}>
            {t('syncDetails.retryCount', { count: entry.retry_count })}
          </Text>
        )}
      </View>

      {isFailed && entry.last_error ? (
        <Text style={styles.errorText} numberOfLines={3}>
          {/* A feature gate is not a fault the operator can fix by retrying, so
              it gets a plain explanation instead of a raw server string. The
              record stays queued and sends intact if the flag is switched back
              on — nothing they entered is thrown away. */}
          {entry.last_error.includes(SEASON_CLOSED_ERROR)
            ? /* The admin closed that year. Retrying cannot reopen it, and the
                 entry keeps its payload — say so, so the operator stops tapping
                 Retry and tells the admin instead. */
              t('syncDetails.seasonClosed')
            : entry.last_error.includes(FEATURE_DISABLED_ERROR)
              ? t('syncDetails.featureDisabled')
              : /* The server rejected the content itself, so retrying as-is cannot
                 help. Say so plainly rather than showing a raw code the operator
                 will keep tapping Retry against. */
                entry.last_error.includes(TERMINAL_REJECTION_ERROR)
                ? t('syncDetails.terminalRejection')
                : entry.last_error}
        </Text>
      ) : null}

      {isFailed && (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => onRetry(entry.id)}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel={t('syncDetails.retryEntryAccessibility')}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.retryButtonText}>{t('syncDetails.retryEntryButton')}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function SyncDetailsScreen() {
  const router = useRouter();
  const { t } = useI18n();
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
      <EntryCard entry={item} onRetry={handleRetryEntry} retrying={syncing} t={t} />
    ),
    [handleRetryEntry, syncing, t],
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
            accessibilityLabel={t('syncDetails.backAccessibility')}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('syncDetails.title')}</Text>
          <TouchableOpacity
            onPress={refresh}
            style={styles.refreshButton}
            accessibilityRole="button"
            accessibilityLabel={t('syncDetails.refreshAccessibility')}
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
            <Text style={styles.summaryLabel}>{t('syncDetails.networkLabel')}</Text>
            <View style={styles.summaryValueRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: isConnected ? colors.success : colors.danger },
                ]}
              />
              <Text style={styles.summaryValue}>
                {isConnected ? t('syncDetails.online') : t('syncDetails.offline')}
              </Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('syncDetails.pendingLabel')}</Text>
            <Text style={[styles.summaryValue, totalUnsent > 0 && styles.valuePending]}>
              {totalUnsent}
            </Text>
          </View>

          {failedCount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('syncDetails.failedLabel')}</Text>
              <Text style={[styles.summaryValue, styles.valueFailed]}>{failedCount}</Text>
            </View>
          )}

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('syncDetails.lastSyncLabel')}</Text>
            <Text style={[styles.summaryValue, styles.summaryValueShrink]} numberOfLines={1}>
              {lastSyncAt ? formatDate(lastSyncAt) : t('syncDetails.lastSyncNever')}
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
              accessibilityLabel={t('syncDetails.retryAllAccessibility')}
            >
              {syncing ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.actionButtonText}>{t('syncDetails.retryAllButton')}</Text>
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
            accessibilityLabel={
              isConnected
                ? t('syncDetails.syncNowAccessibility')
                : t('syncDetails.syncNowNoConnection')
            }
          >
            {syncing ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.actionButtonText}>
                {isConnected
                  ? t('syncDetails.syncNowButton')
                  : t('syncDetails.syncNowNoConnection')}
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
              <Text style={styles.emptyTitle}>{t('syncDetails.emptyTitle')}</Text>
              <Text style={styles.emptySubtitle}>{t('syncDetails.emptySubtitle')}</Text>
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
  summaryValueShrink: { flexShrink: 1, textAlign: 'right' },
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
