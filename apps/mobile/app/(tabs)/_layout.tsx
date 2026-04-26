import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { makeTabBarStyle, tabBarLabelStyle, tabBarActiveTintColor, tabBarInactiveTintColor } from '@/constants/tabBarConfig';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
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
          title: 'Home',
          tabBarAccessibilityLabel: 'Acasă',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="home" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarAccessibilityLabel: 'Scanează',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="qrcode-scan" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarAccessibilityLabel: 'Curse',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="map-marker-path" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarAccessibilityLabel: 'Sincronizare',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="sync" focused={focused} color={color} size={size} />
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
  );
}
