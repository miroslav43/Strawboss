import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import type { MyTask } from '@/hooks/useMyTasks';

const STATUS_COLORS: Record<string, string> = {
  available: '#1565C0',
  in_progress: '#B7791F',
  done: '#2E7D32',
};

const STATUS_LABELS: Record<string, string> = {
  available: 'Disponibil',
  in_progress: 'În lucru',
  done: 'Finalizat',
};

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: '🔴',
  high: '🟠',
  normal: '',
  low: '',
};

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
    // Navigate to the map tab for the current role, with the parcel/destination to focus
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

  const getSubtitle = (task: MyTask): string | null => {
    if (role === 'driver' && task.destinationName) {
      return `📍 ${task.destinationName}`;
    }
    if (task.machineCode) {
      return `🚜 ${task.machineCode}`;
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
          const priority = PRIORITY_INDICATORS[item.priority] ?? '';
          const subtitle = getSubtitle(item);
          return (
            <TouchableOpacity style={styles.card} onPress={() => handlePress(item)}>
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <Text style={styles.sequence}>{item.sequenceOrder}.</Text>
                  <Text style={styles.taskName} numberOfLines={1}>
                    {priority ? `${priority} ` : ''}
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
              {subtitle ? (
                <Text style={styles.subtitle}>{subtitle}</Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#5D4037' },
  list: { gap: 8 },
  emptyContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: '#8D6E63' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
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
  sequence: { fontSize: 14, fontWeight: '700', color: '#0A5C36' },
  taskName: { fontSize: 15, fontWeight: '500', color: '#000', flex: 1 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  subtitle: { fontSize: 13, color: '#5D4037', marginLeft: 22 },
});
