import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { nativeColors } from '@strawboss/ui-tokens/native';
import { useNotifications } from '@/hooks/useNotifications';

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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
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
