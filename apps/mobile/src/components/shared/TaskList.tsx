import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@strawboss/ui-tokens';
import type { MyTask } from '@/hooks/useMyTasks';
import { useTheme } from '@/lib/theme';
import { scale } from '@/utils/responsive';
import { useI18n } from '@/lib/i18n';

const STATUS_COLORS: Record<string, string> = {
  available: '#1565C0',
  in_progress: '#B7791F',
  done: '#2E7D32',
};

// STATUS_LABELS are now derived from i18n inside the component

/** Priority color for the left border stripe. Undefined = no stripe shown. */
const PRIORITY_COLORS: Record<string, string | undefined> = {
  urgent: '#DC2626',
  high: '#EA580C',
  normal: undefined,
  low: undefined,
};

interface SubtitleInfo {
  icon: 'map-marker' | 'tractor';
  text: string;
}

interface TaskListProps {
  tasks: MyTask[];
  /** Role determines how each task card renders and what happens on tap */
  role: 'baler_operator' | 'loader_operator' | 'driver' | string;
  /**
   * T5 — optional override for tap behaviour. When provided, called instead of
   * the default map-focus navigation. Used by the baler home to route taps to
   * the parcel detail screen.
   */
  onTaskPress?: (task: MyTask) => void;
}

export function TaskList({ tasks, role, onTaskPress }: TaskListProps) {
  const { colors: themeColors } = useTheme();
  const { t } = useI18n();

  if (tasks.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: themeColors.white }]}>
        <Text style={[styles.emptyText, { color: themeColors.neutral400 }]}>
          {t('shared.taskList.noTasks')}
        </Text>
      </View>
    );
  }

  const handlePress = (task: MyTask) => {
    if (onTaskPress) {
      onTaskPress(task);
      return;
    }
    const rolePrefix =
      role === 'baler_operator'
        ? '(baler)'
        : role === 'driver'
          ? '(driver)'
          : role === 'loader_operator'
            ? '(loader)'
            : '(tabs)';
    router.push(`/${rolePrefix}/map?focusId=${task.parcelId ?? task.destinationId ?? ''}`);
  };

  const getTaskLabel = (task: MyTask): string => {
    // T9.3 — for baler operators, prefer the parcel `code` over the (deprecated)
    // `name` so the home cards match the rest of the app's identifier strategy.
    if (role === 'baler_operator') {
      return (
        task.parcelCode ??
        task.parcelName ??
        task.destinationCode ??
        task.destinationName ??
        t('shared.taskList.fallbackLabel', { order: task.sequenceOrder })
      );
    }
    if (task.parcelName) return task.parcelName;
    if (task.destinationName) return task.destinationName;
    if (task.parcelCode) return task.parcelCode;
    if (task.destinationCode) return task.destinationCode;
    return t('shared.taskList.fallbackLabel', { order: task.sequenceOrder });
  };

  const getSubtitle = (task: MyTask): SubtitleInfo | null => {
    if (role === 'driver' && task.destinationName) {
      return { icon: 'map-marker', text: task.destinationName };
    }
    if (task.machineCode) {
      return { icon: 'tractor', text: task.machineCode };
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: themeColors.primary }]}>
        {t('shared.taskList.sectionTitle')}
      </Text>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const priorityColor = PRIORITY_COLORS[item.priority];
          const subtitle = getSubtitle(item);
          return (
            <TouchableOpacity
              style={[
                styles.card,
                { backgroundColor: themeColors.white },
                priorityColor !== undefined && {
                  borderLeftWidth: 3,
                  borderLeftColor: priorityColor,
                },
              ]}
              onPress={() => handlePress(item)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <View style={[styles.sequenceCircle, { backgroundColor: themeColors.primary50 }]}>
                    <Text style={[styles.sequence, { color: themeColors.primary }]}>
                      {item.sequenceOrder}
                    </Text>
                  </View>
                  {priorityColor !== undefined && (
                    <MaterialCommunityIcons
                      name="circle"
                      size={10}
                      color={priorityColor}
                      accessibilityLabel={
                        item.priority === 'urgent'
                          ? t('shared.taskList.priorityUrgent')
                          : t('shared.taskList.priorityHigh')
                      }
                    />
                  )}
                  <Text style={[styles.taskName, { color: themeColors.black }]} numberOfLines={1}>
                    {getTaskLabel(item)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: STATUS_COLORS[item.status] ?? themeColors.neutral },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {item.status === 'available'
                      ? t('shared.taskList.statusAvailable')
                      : item.status === 'in_progress'
                        ? t('shared.taskList.statusInProgress')
                        : item.status === 'done'
                          ? t('shared.taskList.statusDone')
                          : item.status}
                  </Text>
                </View>
              </View>
              {subtitle !== null && (
                <View style={styles.subtitleRow}>
                  <MaterialCommunityIcons
                    name={subtitle.icon}
                    size={13}
                    color={themeColors.neutral400}
                  />
                  <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
                    {subtitle.text}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },
  list: { gap: 8 },
  emptyContainer: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: colors.neutral400 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  sequenceCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sequence: { fontSize: 12, fontWeight: '700', color: colors.primary },
  taskName: { fontSize: 15, fontWeight: '500', color: colors.black, flex: 1 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: scale(30) },
  subtitle: { fontSize: 13, color: colors.textSecondary },
});
