import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nativeColors } from '@strawboss/ui-tokens/native';
import type { MobileNotification } from '@/types/notifications';
import { MobileNotificationSeverity, MobileNotificationType } from '@/types/notifications';
import { useNotifications } from '@/hooks/useNotifications';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useI18n } from '@/lib/i18n';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

function groupByDay(
  items: MobileNotification[],
  today: string,
  yesterday: string,
): { date: string; data: MobileNotification[] }[] {
  const now = new Date();
  const yesterdayDate = new Date(now.getTime() - MS_PER_DAY);
  const map = new Map<string, MobileNotification[]>();
  for (const item of items) {
    const d = new Date(item.createdAt);
    let key: string;
    if (isSameDay(d, now)) {
      key = today;
    } else if (isSameDay(d, yesterdayDate)) {
      key = yesterday;
    } else {
      key = d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' });
    }
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([date, data]) => ({ date, data }));
}

function severityColor(severity: MobileNotificationSeverity): string {
  switch (severity) {
    case MobileNotificationSeverity.critical:
      return nativeColors.danger;
    case MobileNotificationSeverity.warning:
      return nativeColors.warning;
    case MobileNotificationSeverity.success:
      return nativeColors.success;
    case MobileNotificationSeverity.info:
      return nativeColors.info;
    default:
      return nativeColors.info;
  }
}

function typeIcon(
  type: MobileNotificationType,
): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (type) {
    case MobileNotificationType.parcel_entered:
      return 'tractor';
    case MobileNotificationType.parcel_exit_confirm:
      return 'help-circle';
    case MobileNotificationType.deposit_entered:
      return 'warehouse';
    case MobileNotificationType.assignment_created:
      return 'clipboard-list';
    case MobileNotificationType.truck_arrived_at_loader:
      return 'truck';
    case MobileNotificationType.trip_loaded:
      return 'package-variant';
    case MobileNotificationType.trip_departed:
      return 'truck-fast';
    case MobileNotificationType.trip_arrived:
      return 'map-marker-check';
    case MobileNotificationType.trip_completed:
      return 'check-circle';
    case MobileNotificationType.trip_disputed:
      return 'alert-circle';
    case MobileNotificationType.broadcast:
      return 'bullhorn';
    default:
      return 'bell';
  }
}

interface NotificationItemProps {
  item: MobileNotification;
  onPress: (item: MobileNotification) => void;
  onLongPress: (item: MobileNotification) => void;
}

function NotificationItem({ item, onPress, onLongPress }: NotificationItemProps) {
  const stripeColor = severityColor(item.severity);
  const icon = typeIcon(item.type);

  return (
    <Pressable
      style={styles.item}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.body}`}
    >
      <View style={[styles.severityStripe, { backgroundColor: stripeColor }]} />
      <View style={[styles.iconContainer, { backgroundColor: stripeColor + '22' }]}>
        <MaterialCommunityIcons name={icon} size={22} color={stripeColor} />
      </View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text style={[styles.itemTitle, item.isRead && styles.itemTitleRead]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.itemTime} numberOfLines={1}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
        <Text style={styles.itemBody} numberOfLines={2}>
          {item.body}
        </Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { items, unreadCount, markAsRead, markAllAsRead, deleteNotification, refresh } =
    useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const { modalProps, showModal, hideModal } = useModal();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handlePress = useCallback(
    (item: MobileNotification) => {
      if (!item.isRead) {
        void markAsRead(item.id);
      }
      try {
        const data = item.dataJson
          ? (JSON.parse(item.dataJson) as { tripId?: string; assignmentId?: string })
          : null;
        if (data?.tripId) {
          router.push(`/trip/${data.tripId}`);
        }
      } catch {
        // Malformed JSON — just mark read and stay on the page.
      }
    },
    [markAsRead, router],
  );

  const handleLongPress = useCallback(
    (item: MobileNotification) => {
      showModal({
        type: 'confirm',
        title: t('notifications.deleteConfirmTitle'),
        message: item.title,
        confirmText: t('notifications.deleteConfirmButton'),
        onConfirm: () => {
          void deleteNotification(item.id);
          hideModal();
        },
        onCancel: hideModal,
      });
    },
    [deleteNotification, showModal, hideModal, t],
  );

  const handleMarkAllRead = useCallback(() => {
    void markAllAsRead();
  }, [markAllAsRead]);

  const groups = groupByDay(items, t('notifications.dayToday'), t('notifications.dayYesterday'));

  const unreadLabel =
    unreadCount === 1
      ? t('notifications.unreadSingular', { count: unreadCount })
      : t('notifications.unreadPlural', { count: unreadCount });

  const headerRight = (
    <View style={styles.headerRightGroup}>
      {unreadCount > 0 && (
        <TouchableOpacity
          onPress={handleMarkAllRead}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.markAllAccessibility')}
          style={styles.markAllBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.markAllText}>{t('notifications.markAllButton')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('notifications.title')} right={headerRight}>
        <Text style={styles.subtitle}>
          {unreadCount > 0 ? unreadLabel : t('notifications.allRead')}
        </Text>
      </ScreenHeader>

      {items.length === 0 ? (
        <View style={styles.body}>
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="bell-off-outline"
              size={64}
              color={nativeColors.neutral300}
            />
            <Text style={styles.emptyTitle}>{t('notifications.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t('notifications.emptyBody')}</Text>
          </View>
        </View>
      ) : (
        <FlatList
          style={styles.body}
          data={groups}
          keyExtractor={(g) => g.date}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={nativeColors.primary}
              colors={[nativeColors.primary]}
            />
          }
          renderItem={({ item: group }) => (
            <View>
              <Text style={styles.dayHeader}>{group.date}</Text>
              {group.data.map((n) => (
                <NotificationItem
                  key={n.id}
                  item={n}
                  onPress={handlePress}
                  onLongPress={handleLongPress}
                />
              ))}
            </View>
          )}
        />
      )}
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: nativeColors.primary,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  markAllText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    backgroundColor: nativeColors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  dayHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    color: nativeColors.neutral500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingRight: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  severityStripe: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: 12,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 10,
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: nativeColors.neutral800,
  },
  itemTitleRead: {
    fontWeight: '500',
    color: nativeColors.neutral500,
  },
  itemTime: {
    fontSize: 12,
    color: nativeColors.neutral400,
    marginLeft: 8,
    flexShrink: 0,
  },
  itemBody: {
    fontSize: 13,
    color: nativeColors.neutral500,
    lineHeight: 18,
  },
  unreadDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: nativeColors.secondary,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: nativeColors.neutral500,
  },
  emptyBody: {
    fontSize: 14,
    color: nativeColors.neutral400,
    textAlign: 'center',
  },
});
