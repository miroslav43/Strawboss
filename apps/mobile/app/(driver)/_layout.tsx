import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    'Cursele Mele': '🚛',
    'Livrare': '📋',
    'Hartă': '🗺️',
    'Combustibil': '⛽',
    'Profil': '👤',
  };
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[label] ?? '?'}
    </Text>
  );
}

export default function DriverTabLayout() {
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
          title: 'Cursele Mele',
          tabBarIcon: ({ focused }) => <TabIcon label="Cursele Mele" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="delivery"
        options={{
          title: 'Livrare',
          tabBarIcon: ({ focused }) => <TabIcon label="Livrare" focused={focused} />,
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
        name="fuel"
        options={{
          title: 'Combustibil',
          tabBarIcon: ({ focused }) => <TabIcon label="Combustibil" focused={focused} />,
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
