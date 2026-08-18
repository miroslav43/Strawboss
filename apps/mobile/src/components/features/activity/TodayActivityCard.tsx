/**
 * FM-11: Expandable card that lists the current operator's activity for today,
 * read exclusively from local SQLite (works offline).
 *
 * Each entry shows: kind icon, label, detail, timestamp, and sync status
 * (sincronizat / in asteptare / esuat).
 */

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii } from '@strawboss/ui-tokens';
import { scale, fontScale } from '@/utils/responsive';
import { useTodayActivity, type ActivityEntry, type ActivityKind } from '@/hooks/useTodayActivity';
import { dateLocaleFor, useI18n } from '@/lib/i18n';

// ---- Icon map ---------------------------------------------------------------

type MDIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const KIND_ICON: Record<ActivityKind, MDIName> = {
  production: 'grain',
  fuel: 'gas-station',
  consumable: 'package-variant',
  load: 'truck-cargo-container',
};

const KIND_COLOR: Record<ActivityKind, string> = {
  production: '#0A5C36',
  fuel: '#B7791F',
  consumable: '#1565C0',
  load: '#5D4037',
};

// ---- Sync status badge ------------------------------------------------------

const SYNC_BADGE_KEYS: Record<
  ActivityEntry['syncStatus'],
  { labelKey: string; bg: string; text: string }
> = {
  synced: { labelKey: 'activity.todayCard.syncStatus.synced', bg: '#E8F5E9', text: '#2E7D32' },
  pending: { labelKey: 'activity.todayCard.syncStatus.pending', bg: '#FFF8E1', text: '#B7791F' },
  failed: { labelKey: 'activity.todayCard.syncStatus.failed', bg: '#FFEBEE', text: '#C62828' },
};

// ---- Helpers ----------------------------------------------------------------

function formatTime(isoTimestamp: string, dateLocale: string): string {
  try {
    return new Date(isoTimestamp).toLocaleTimeString(dateLocale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    });
  } catch {
    return '??:??';
  }
}

// ---- Entry row --------------------------------------------------------------

function ActivityRow({
  entry,
  t,
  dateLocale,
}: {
  entry: ActivityEntry;
  t: (key: string) => string;
  dateLocale: string;
}) {
  const badge = SYNC_BADGE_KEYS[entry.syncStatus];
  const iconColor = KIND_COLOR[entry.kind];

  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: iconColor + '18' }]}>
        <MaterialCommunityIcons name={KIND_ICON[entry.kind]} size={18} color={iconColor} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {entry.label}
          </Text>
          <Text style={styles.rowTime}>{formatTime(entry.timestamp, dateLocale)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.rowDetail} numberOfLines={1}>
            {entry.detail}
          </Text>
          <View style={[styles.syncBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.syncBadgeText, { color: badge.text }]}>{t(badge.labelKey)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---- Main card --------------------------------------------------------------

interface TodayActivityCardProps {
  operatorId: string | null | undefined;
}

export function TodayActivityCard({ operatorId }: TodayActivityCardProps) {
  const { t, locale } = useI18n();
  const dateLocale = dateLocaleFor(locale);
  const [expanded, setExpanded] = useState(false);
  const { entries, loading, error, refresh } = useTodayActivity(operatorId);

  const pendingCount = entries.filter((e) => e.syncStatus !== 'synced').length;

  return (
    <View style={styles.card}>
      {/* Header — always visible, toggles expand */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={
          expanded
            ? t('activity.todayCard.accessibility.collapse')
            : t('activity.todayCard.accessibility.expand')
        }
      >
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="calendar-today" size={18} color={colors.primary} />
          <Text style={styles.headerTitle}>{t('activity.todayCard.headerTitle')}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.headerLoader} />
          ) : (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{entries.length}</Text>
            </View>
          )}
          {!loading && pendingCount > 0 ? (
            <View
              style={styles.pendingDot}
              accessibilityLabel={t('activity.todayCard.accessibility.pendingCount').replace(
                '{count}',
                String(pendingCount),
              )}
            />
          ) : null}
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.neutral}
        />
      </TouchableOpacity>

      {/* Expanded body */}
      {expanded ? (
        <View style={styles.body}>
          {error ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => void refresh()} activeOpacity={0.8}>
                <Text style={styles.retryText}>{t('activity.todayCard.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.centered}>
              <MaterialCommunityIcons
                name="clipboard-outline"
                size={32}
                color={colors.neutral200}
              />
              <Text style={styles.emptyText}>{t('activity.todayCard.empty.text')}</Text>
              <Text style={styles.emptySubtext}>{t('activity.todayCard.empty.subtext')}</Text>
            </View>
          ) : (
            <FlatList
              data={entries}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <ActivityRow entry={item} t={t} dateLocale={dateLocale} />}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              scrollEnabled={false}
              style={styles.list}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

// ---- Styles -----------------------------------------------------------------

const CARD_RADIUS = scale(16);
const CARD_PADDING = scale(16);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: CARD_RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: CARD_PADDING,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: fontScale(14),
    fontWeight: '700',
    color: colors.primary,
  },
  headerLoader: {
    marginLeft: 4,
  },
  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countBadgeText: {
    color: colors.white,
    fontSize: fontScale(11),
    fontWeight: '700',
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B7791F',
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.neutral200,
  },
  list: {
    paddingHorizontal: CARD_PADDING,
    paddingTop: 4,
    paddingBottom: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.neutral200,
    marginVertical: 6,
  },
  centered: {
    padding: CARD_PADDING,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: fontScale(14),
    color: colors.neutral,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: fontScale(12),
    color: colors.neutral200,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorRow: {
    padding: CARD_PADDING,
    gap: 8,
    alignItems: 'flex-start',
  },
  errorText: {
    fontSize: fontScale(13),
    color: colors.danger,
  },
  retryText: {
    fontSize: fontScale(13),
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  // Entry row
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  rowLabel: {
    fontSize: fontScale(13),
    fontWeight: '600',
    color: '#374151',
    flex: 1,
  },
  rowTime: {
    fontSize: fontScale(12),
    color: colors.neutral,
    flexShrink: 0,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  rowDetail: {
    fontSize: fontScale(12),
    color: colors.neutral,
    flex: 1,
  },
  syncBadge: {
    borderRadius: radii.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexShrink: 0,
  },
  syncBadgeText: {
    fontSize: fontScale(10),
    fontWeight: '600',
  },
});
