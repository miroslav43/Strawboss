import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { SyncQueueBannerHost } from '@/components/shared/SyncQueueBannerHost';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';

/**
 * Plan C — depot_manager tab group. Three tabs: Inventar (today's
 * snapshot), Curse (incoming trucks), Profil (shared profile screen).
 * The role does NOT use GPS tracking, geofence overlays, or QR scanning,
 * so the layout is intentionally simpler than (loader)/_layout.tsx.
 */
export default function DepositTabLayout() {
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
              title: 'Inventar',
              tabBarAccessibilityLabel: 'Inventar depozit',
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="warehouse" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="trips"
            options={{
              title: 'Curse',
              tabBarAccessibilityLabel: 'Curse incoming',
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="truck-fast" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Profil',
              tabBarAccessibilityLabel: 'Profil',
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="account-circle" focused={focused} color={color} size={size} />
              ),
            }}
          />
        </Tabs>
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
