import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';
import { useI18n } from '@/lib/i18n';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

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
          title: t('tabs.label.home'),
          tabBarAccessibilityLabel: t('tabs.label.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="home" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t('tabs.label.scan'),
          tabBarAccessibilityLabel: t('tabs.label.scan'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="qrcode-scan" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: t('tabs.label.incomingTrips'),
          tabBarAccessibilityLabel: t('tabs.label.incomingTrips'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="map-marker-path" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: t('tabs.label.sync'),
          tabBarAccessibilityLabel: t('tabs.label.sync'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="sync" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.label.profile'),
          tabBarAccessibilityLabel: t('tabs.label.profile'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="account" focused={focused} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
