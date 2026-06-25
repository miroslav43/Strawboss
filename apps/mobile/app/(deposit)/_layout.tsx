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

/**
 * Plan C — depot_manager tab group. Three tabs: Inventar (today's
 * snapshot), Curse (incoming trucks), Profil (shared profile screen).
 * The role does NOT use GPS tracking, geofence overlays, or QR scanning,
 * so the layout is intentionally simpler than (loader)/_layout.tsx.
 */
export default function DepositTabLayout() {
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
          <Tabs.Screen
            name="index"
            options={{
              title: t('tabs.label.inventory'),
              tabBarAccessibilityLabel: t('tabs.label.inventory'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="warehouse" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="trips"
            options={{
              title: t('tabs.label.incomingTrips'),
              tabBarAccessibilityLabel: t('tabs.label.incomingTrips'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="truck-fast" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: t('tabs.label.profile'),
              tabBarAccessibilityLabel: t('tabs.label.profile'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="account-circle" focused={focused} color={color} size={size} />
              ),
            }}
          />
          {/* Confirm-delivery is a detail screen reached from the Curse tab, not
              a tab itself. href:null suppresses the phantom tab icon. */}
          <Tabs.Screen name="confirm-delivery" options={{ href: null }} />
        </Tabs>
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
