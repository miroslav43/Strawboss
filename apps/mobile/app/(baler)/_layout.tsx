import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { makeTabBarStyle, tabBarLabelStyle, tabBarActiveTintColor, tabBarInactiveTintColor } from '@/constants/tabBarConfig';

export default function BalerTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaProvider>
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor,
          tabBarInactiveTintColor,
          tabBarStyle: makeTabBarStyle(insets.bottom),
          tabBarLabelStyle,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Acasă',
            tabBarAccessibilityLabel: 'Acasă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="home" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="production"
          options={{
            title: 'Producție',
            tabBarAccessibilityLabel: 'Înregistrează producție',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="counter" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="map" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="consumables"
          options={{
            title: 'Consumabile',
            tabBarAccessibilityLabel: 'Consumabile',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="package-variant-closed" focused={focused} color={color} size={size} />
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
      <GeofenceOverlay
        alert={activeAlert}
        onDismiss={dismissAlert}
        onConfirmParcelDone={confirmParcelDone}
      />
    </View>
    </SafeAreaProvider>
  );
}
