import * as Notifications from 'expo-notifications';
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
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Add a listener for incoming notifications while the app is foregrounded.
 */
export function addNotificationListener(
  handler: (notification: Notifications.Notification) => void,
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(handler);
}

/**
 * Add a listener for when the user taps on a notification.
 */
export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
