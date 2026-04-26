import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function LoaderTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();
  const insets = useSafeAreaInsets();
  const tabBarBottom = Math.max(12, insets.bottom);

  return (
    <SafeAreaProvider>
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0A5C36',
          tabBarInactiveTintColor: '#8D6E63',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#D7CCC8',
            height: 60 + tabBarBottom,
            paddingBottom: tabBarBottom,
            paddingTop: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Camioane',
            tabBarAccessibilityLabel: 'Scanează camion',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="qrcode-scan" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="bales"
          options={{
            title: 'Încărcări',
            tabBarAccessibilityLabel: 'Încărcări',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="package-variant-closed" focused={focused} color={color} size={size} />
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
            title: 'Motorină',
            tabBarAccessibilityLabel: 'Motorină',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="gas-station" focused={focused} color={color} size={size} />
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
