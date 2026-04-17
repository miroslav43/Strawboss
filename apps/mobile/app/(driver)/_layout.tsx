import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';

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
            tabBarAccessibilityLabel: 'Cursele mele',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="truck" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="delivery"
          options={{
            title: 'Livrare',
            tabBarAccessibilityLabel: 'Livrare',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="clipboard-list" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="map" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="fuel"
          options={{
            title: 'Combustibil',
            tabBarAccessibilityLabel: 'Combustibil',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="gas-station" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarAccessibilityLabel: 'Profilul meu',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="account" size={size} color={color} />
            ),
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
