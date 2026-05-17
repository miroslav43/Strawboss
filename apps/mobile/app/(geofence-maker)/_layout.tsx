import { Tabs } from 'expo-router';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';

export default function GeofenceMakerTabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor,
          tabBarInactiveTintColor,
          tabBarStyle: makeTabBarStyle(insets.bottom),
          tabBarLabelStyle,
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă geofence',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="map-marker-plus" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="farms"
          options={{
            title: 'Ferme',
            tabBarAccessibilityLabel: 'Ferme și câmpuri',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="home-group" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarAccessibilityLabel: 'Profilul meu',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="account" focused={focused} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </SafeAreaProvider>
  );
}
