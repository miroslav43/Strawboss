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
import { useI18n } from '@/lib/i18n';

export default function GeofenceMakerTabLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

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
          <Tabs.Screen name="index" options={{ href: null }} />
          <Tabs.Screen
            name="map"
            options={{
              title: t('tabs.label.map'),
              tabBarAccessibilityLabel: t('tabs.label.map'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="map-marker-plus" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="farms"
            options={{
              title: t('tabs.label.farms'),
              tabBarAccessibilityLabel: t('tabs.label.farms'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="home-group" focused={focused} color={color} size={size} />
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
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
