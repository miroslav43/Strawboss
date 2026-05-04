import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Configure notification handler defaults.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request push notification permissions and register for push notifications.
 * Returns the Expo push token or null if permissions were denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Set up Android notification channels
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('geofence', {
      name: 'Geofence',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
    /** Used alongside expo-location foreground service (user-visible persistent GPS). */
    await Notifications.setNotificationChannelAsync('location', {
      name: 'Locație GPS',
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: [0, 0],
    });
  }

  // Fetching the Expo push token requires Firebase (FCM) credentials on Android.
  // In dev / self-hosted builds without google-services.json the call throws with
  // "Default FirebaseApp is not initialized". Treat that as a recoverable no-op
  // so the rest of the app (local notifications, channels) keeps working.
  // The projectId is required for Expo's managed push service; falls back to slug
  // when not explicitly configured via EAS.
  const projectId: string | undefined =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined;

  // In Expo Go dev builds without an EAS projectId, getExpoPushTokenAsync throws
  // ("Default FirebaseApp is not initialized"). Local notifications still work fine.
  if (__DEV__ && !projectId) {
    console.info('[StrawBoss] DEV: no EAS projectId — skipping push token (local notifications active)');
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenData.data;
  } catch (err) {
    if (__DEV__) console.warn('[StrawBoss] DEV: getExpoPushTokenAsync failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Add a listener for incoming notifications while the app is foregrounded.
 */
export function addNotificationListener(
  handler: (notification: Notifications.Notification) => void,
): ReturnType<typeof Notifications.addNotificationReceivedListener> {
  return Notifications.addNotificationReceivedListener(handler);
}

/**
 * Add a listener for when the user taps on a notification.
 */
export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): ReturnType<typeof Notifications.addNotificationResponseReceivedListener> {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
