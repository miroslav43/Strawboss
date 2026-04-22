import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nativeColors } from '@strawboss/ui-tokens/native';
import type { MobileNotification } from '@/types/notifications';
import { MobileNotificationSeverity } from '@/types/notifications';
import { useNotifications } from '@/hooks/useNotifications';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

function groupByDay(items: MobileNotification[]): { date: string; data: MobileNotification[] }[] {
  const map = new Map<string, MobileNotification[]>();
  for (const item of items) {
    const key = formatDate(item.createdAt);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([date, data]) => ({ date, data }));
}

function severityColor(severity: MobileNotificationSeverity): string {
  switch (severity) {
    case MobileNotificationSeverity.critical: return nativeColors.danger;
    case MobileNotificationSeverity.warning: return nativeColors.warning;
    case MobileNotificationSeverity.success: return nativeColors.success;
    default: return nativeColors.info;
  }
}

function severityIcon(severity: MobileNotificationSeverity): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (severity) {
    case MobileNotificationSeverity.critical: return 'alert-circle';
    case MobileNotificationSeverity.warning: return 'alert';
    case MobileNotificationSeverity.success: return 'check-circle';
    default: return 'information';
  }
}

interface NotificationItemProps {
  item: MobileNotification;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
}

function NotificationItem({ item, onRead, onDelete }: NotificationItemProps) {
  const color = severityColor(item.severity);
  const icon = severityIcon(item.severity);

  return (
    <Pressable
      style={[styles.item, item.isRead && styles.itemRead]}
      onPress={() => !item.isRead && onRead(item.id)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text style={[styles.itemTitle, item.isRead && styles.textRead]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.itemTime}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text style={[styles.itemBody, item.isRead && styles.textRead]} numberOfLines={2}>
          {item.body}
        </Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => onDelete(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Șterge notificarea"
      >
        <MaterialCommunityIcons name="close" size={16} color={nativeColors.neutral400} />
      </TouchableOpacity>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications();

  const groups = groupByDay(items);

  const handleMarkAllRead = useCallback(async () => {
    await markAllAsRead();
  }, [markAllAsRead]);

  if (items.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={nativeColors.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notificări</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.empty}>
          <MaterialCommunityIcons name="bell-off-outline" size={56} color={nativeColors.neutral300} />
          <Text style={styles.emptyTitle}>Nicio notificare</Text>
          <Text style={styles.emptyBody}>Notificările vor apărea aici</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={nativeColors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notificări</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Marchează tot</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      <FlatList
        data={groups}
        keyExtractor={g => g.date}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: group }) => (
          <View>
            <Text style={styles.dayHeader}>{group.date}</Text>
            {group.data.map(n => (
              <NotificationItem
                key={n.id}
                item={n}
                onRead={markAsRead}
                onDelete={deleteNotification}
              />
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: nativeColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: nativeColors.neutral100,
  },
  backBtn: {
    width: 36,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: nativeColors.primary,
  },
  headerRight: {
    width: 80,
  },
  markAllBtn: {
    width: 80,
    alignItems: 'flex-end',
  },
  markAllText: {
    fontSize: 13,
    color: nativeColors.secondary,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  dayHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 13,
    fontWeight: '600',
    color: nativeColors.neutral400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  itemRead: {
    opacity: 0.65,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: nativeColors.primary,
  },
  itemTime: {
    fontSize: 12,
    color: nativeColors.neutral300,
    marginLeft: 8,
    flexShrink: 0,
  },
  itemBody: {
    fontSize: 13,
    color: nativeColors.neutral500,
    lineHeight: 18,
  },
  textRead: {
    fontWeight: '400',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: nativeColors.secondary,
    marginTop: 4,
    flexShrink: 0,
  },
  deleteBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: nativeColors.neutral500,
  },
  emptyBody: {
    fontSize: 14,
    color: nativeColors.neutral300,
  },
});
