import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { nativeColors } from '@strawboss/ui-tokens/native';
import { scale } from '@/utils/responsive';
import { useNotifications } from '@/hooks/useNotifications';

const BELL_SIZE = Math.max(44, scale(44)); // iOS minimum 44pt touch target
const BADGE_SIZE = scale(16);

interface NotificationBellProps {
  color?: string;
}

export function NotificationBell({ color = '#FFFFFF' }: NotificationBellProps) {
  const router = useRouter();
  const { unreadCount } = useNotifications();

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/notifications')}
      accessibilityLabel="Notificări"
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialCommunityIcons name="bell-outline" size={24} color={color} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? '99+' : String(unreadCount)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: BELL_SIZE,
    height: BELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: nativeColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
