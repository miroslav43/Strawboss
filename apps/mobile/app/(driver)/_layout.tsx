import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { useTripLoadedAlert } from '@/hooks/useTripLoadedAlert';
import { TripLoadedOverlay } from '@/components/features/driver/TripLoadedOverlay';
import { DriverDepotArrivalOverlay } from '@/components/features/driver/DriverDepotArrivalOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { SyncQueueBannerHost } from '@/components/shared/SyncQueueBannerHost';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';
import { useI18n } from '@/lib/i18n';

export default function DriverTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone, confirmParcelEntry, cancelParcelEntry } =
    useGeofenceNotifications();
  const { activeAlert: tripAlert, dismiss: dismissTripAlert, onDeparted } = useTripLoadedAlert();
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
              title: t('tabs.label.myTrips'),
              tabBarAccessibilityLabel: t('tabs.label.myTrips'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="truck" focused={focused} color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="delivery"
            options={{
              title: t('tabs.label.delivery'),
              tabBarAccessibilityLabel: t('tabs.label.delivery'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="clipboard-list" focused={focused} color={color} size={size} />
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
            name="fuel"
            options={{
              title: t('tabs.label.fuel'),
              tabBarAccessibilityLabel: t('tabs.label.fuel'),
              tabBarIcon: ({ color, size, focused }) => (
                <TabBarIcon name="gas-station" focused={focused} color={color} size={size} />
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
        <GeofenceOverlay
          alert={activeAlert}
          onDismiss={dismissAlert}
          onConfirmParcelDone={confirmParcelDone}
          onConfirmParcelEntry={confirmParcelEntry}
          onCancelParcelEntry={cancelParcelEntry}
        />
        <TripLoadedOverlay
          alert={tripAlert}
          onDismiss={() => void dismissTripAlert()}
          onDeparted={onDeparted}
        />
        {/* Client-side GPS fallback for depot arrival — suppressed while the
            push-driven deposit_entry overlay is already showing. */}
        <DriverDepotArrivalOverlay suppressed={activeAlert?.type === 'deposit_entry'} />
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
