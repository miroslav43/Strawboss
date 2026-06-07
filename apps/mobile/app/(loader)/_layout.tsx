import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { useLoaderRecallPrompt } from '@/hooks/useLoaderRecallPrompt';
import { LoaderRecallOverlay } from '@/components/features/loader/LoaderRecallOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { SyncQueueBannerHost } from '@/components/shared/SyncQueueBannerHost';
import {
  makeTabBarStyle,
  tabBarLabelStyle,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
} from '@/constants/tabBarConfig';

export default function LoaderTabLayout() {
  const {
    activeAlert,
    dismissAlert,
    confirmParcelDone,
    confirmParcelLoaded,
    confirmParcelEntry,
    cancelParcelEntry,
  } = useGeofenceNotifications();
  const {
    prompt: recallPrompt,
    respond: respondRecall,
    pending: recallPending,
  } = useLoaderRecallPrompt();
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
          {/* Parcel detail is a deep-linked route (opened from the home banner /
              candidate rows), not a tab. href:null keeps Expo Router from
              auto-adding a phantom icon-less "parcel" tab. */}
          <Tabs.Screen name="parcel/[parcelId]" options={{ href: null }} />
        </Tabs>
        <GeofenceOverlay
          alert={activeAlert}
          onDismiss={dismissAlert}
          onConfirmParcelDone={confirmParcelDone}
          onConfirmParcelEntry={confirmParcelEntry}
          onCancelParcelEntry={cancelParcelEntry}
          onConfirmParcelLoaded={confirmParcelLoaded}
        />
        <LoaderRecallOverlay
          prompt={recallPrompt}
          pending={recallPending}
          onRespond={respondRecall}
        />
        <SyncQueueBannerHost />
      </View>
    </SafeAreaProvider>
  );
}
