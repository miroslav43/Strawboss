import { Tabs } from 'expo-router';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0A5C36',
        tabBarInactiveTintColor: '#8D6E63',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#D7CCC8',
          height: 72,
          paddingBottom: 12,
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
