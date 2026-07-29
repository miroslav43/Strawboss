import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { SyncQueueBannerHost } from '@/components/shared/SyncQueueBannerHost';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';
import { useI18n } from '@/lib/i18n';
import { featureTabOptions, useIsFeatureEnabled } from '@/stores/features-store';

export default function BalerTabLayout() {
  const costsEnabled = useIsFeatureEnabled('costs.consumables');
  const { activeAlert, dismissAlert, confirmParcelDone, confirmParcelEntry, cancelParcelEntry } =
    useGeofenceNotifications();
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
              title: t('tabs.label.home'),
              tabBarAccessibilityLabel: t('tabs.label.home'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="home" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="production"
            options={{
              title: t('tabs.label.production'),
              tabBarAccessibilityLabel: t('tabs.label.production'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="counter" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="map"
            options={{
              title: t('tabs.label.map'),
              tabBarAccessibilityLabel: t('tabs.label.map'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="map" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="consumables"
            options={{
              ...featureTabOptions(costsEnabled, 4),
              title: t('tabs.label.consumables'),
              tabBarAccessibilityLabel: t('tabs.label.consumables'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon
                  name="package-variant-closed"
                  focused={focused}
                  color={color}
                  size={size}
                />
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
          {/* Parcel detail is a deep-linked route (opened from the task list), not a
              tab. Without href:null Expo Router auto-adds a phantom icon-less
              "parcel" tab to the right of Profile. */}
          <Tabs.Screen name="parcel/[parcelId]" options={{ href: null }} />
        </Tabs>
        <GeofenceOverlay
          alert={activeAlert}
          onDismiss={dismissAlert}
          onConfirmParcelDone={confirmParcelDone}
          onConfirmParcelEntry={confirmParcelEntry}
          onCancelParcelEntry={cancelParcelEntry}
        />
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
