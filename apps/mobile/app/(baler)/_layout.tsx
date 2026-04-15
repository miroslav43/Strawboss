import { Tabs } from 'expo-router';
import { Text, StyleSheet } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    'Acasă': '🌾',
    'Consumabile': '⛽',
    'Starea Mea': '📊',
    'Profil': '👤',
  };
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[label] ?? '?'}
    </Text>
  );
}

export default function BalerTabLayout() {
  useGeofenceNotifications();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0A5C36',
        tabBarInactiveTintColor: '#8D6E63',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#D7CCC8',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Acasă',
          tabBarIcon: ({ focused }) => <TabIcon label="Acasă" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="consumables"
        options={{
          title: 'Consumabile',
          tabBarIcon: ({ focused }) => <TabIcon label="Consumabile" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Starea Mea',
          tabBarIcon: ({ focused }) => <TabIcon label="Starea Mea" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon label="Profil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 22 },
  iconFocused: { opacity: 1 },
});
