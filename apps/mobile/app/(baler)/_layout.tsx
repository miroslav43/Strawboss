import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    'Acasă': '🌾',
    'Consumabile': '⛽',
    'Hartă': '🗺️',
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
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();

  return (
    <View style={{ flex: 1 }}>
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
        name="map"
        options={{
          title: 'Hartă',
          tabBarIcon: ({ focused }) => <TabIcon label="Hartă" focused={focused} />,
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
    <GeofenceOverlay
      alert={activeAlert}
      onDismiss={dismissAlert}
      onConfirmParcelDone={confirmParcelDone}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 22 },
  iconFocused: { opacity: 1 },
});
