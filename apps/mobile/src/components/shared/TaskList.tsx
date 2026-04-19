import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@strawboss/ui-tokens';
import type { MyTask } from '@/hooks/useMyTasks';

const STATUS_COLORS: Record<string, string> = {
  available:   '#1565C0',
  in_progress: '#B7791F',
  done:        '#2E7D32',
};

const STATUS_LABELS: Record<string, string> = {
  available:   'Disponibil',
  in_progress: 'În lucru',
  done:        'Finalizat',
};

/** Priority color for the left border stripe. Undefined = no stripe shown. */
const PRIORITY_COLORS: Record<string, string | undefined> = {
  urgent: '#DC2626',
  high:   '#EA580C',
  normal: undefined,
  low:    undefined,
};

interface SubtitleInfo {
  icon: 'map-marker' | 'tractor';
  text: string;
}

interface TaskListProps {
  tasks: MyTask[];
  /** Role determines how each task card renders and what happens on tap */
  role: 'baler_operator' | 'loader_operator' | 'driver' | string;
}

export function TaskList({ tasks, role }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Nicio sarcină asignată pentru azi.</Text>
      </View>
    );
  }

  const handlePress = (task: MyTask) => {
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
    if (task.parcelName) return task.parcelName;
    if (task.destinationName) return task.destinationName;
    if (task.parcelCode) return task.parcelCode;
    if (task.destinationCode) return task.destinationCode;
    return `Sarcina #${task.sequenceOrder}`;
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
      <Text style={styles.sectionTitle}>Sarcini Azi</Text>
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
                priorityColor !== undefined && {
                  borderLeftWidth: 3,
                  borderLeftColor: priorityColor,
                },
              ]}
              onPress={() => handlePress(item)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <View style={styles.sequenceCircle}>
                    <Text style={styles.sequence}>{item.sequenceOrder}</Text>
                  </View>
                  {priorityColor !== undefined && (
                    <MaterialCommunityIcons
                      name="circle"
                      size={10}
                      color={priorityColor}
                      accessibilityLabel={item.priority === 'urgent' ? 'Urgent' : 'Prioritate mare'}
                    />
                  )}
                  <Text style={styles.taskName} numberOfLines={1}>
                    {getTaskLabel(item)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              {subtitle !== null && (
                <View style={styles.subtitleRow}>
                  <MaterialCommunityIcons
                    name={subtitle.icon}
                    size={13}
                    color={colors.neutral400}
                  />
                  <Text style={styles.subtitle}>{subtitle.text}</Text>
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
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 30 },
  subtitle: { fontSize: 13, color: colors.neutral },
});
