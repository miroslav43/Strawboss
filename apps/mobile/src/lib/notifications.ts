import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { REMOTE_NOTIFICATION_TASK } from './remote-notification-task';
import { isPushForCurrentUser } from './push-recipient';

/**
 * Configure notification handler defaults.
 *
 * Foreground pushes addressed to a different user (shared-device stale token)
 * are suppressed entirely — no banner, sound, badge or list entry. Fail-open:
 * anything without a mismatching `recipientUserId` shows as before.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    if (!isPushForCurrentUser(data)) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
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
    /**
     * T6 — dedicated loud channel for baler geofence exit ("Ai ieșit din
     * parcelă"). MAX importance + bypass DND so the operator hears the horn
     * even when the phone is silenced. The custom sound resource
     * `baler_exit` is not yet committed (see
     * `assets/sounds/README-baler-exit.md`); until it lands the channel
     * falls back to the device default notification tone. Vibration +
     * bypass-DND still fire.
     */
    await Notifications.setNotificationChannelAsync('baler-exit', {
      name: 'Alertă ieșire câmp',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'baler_exit',
      vibrationPattern: [0, 400, 200, 400],
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableLights: true,
      lightColor: '#C62828',
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
    console.info(
      '[StrawBoss] DEV: no EAS projectId — skipping push token (local notifications active)',
    );
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenData.data;
  } catch (err) {
    if (__DEV__)
      console.warn(
        '[StrawBoss] DEV: getExpoPushTokenAsync failed:',
        err instanceof Error ? err.message : String(err),
      );
    return null;
  }
}

/**
 * Activate the background FCM data-message task with expo-notifications so incoming
 * pushes — including data-only presence-wakes from the backend dead-man — are dispatched
 * to `REMOTE_NOTIFICATION_TASK` even when the app is backgrounded or terminated. The task
 * is DEFINED at the bundle entry (remote-notification-task.ts via
 * register-background-tasks.ts); this call registers it with expo-task-manager.
 *
 * Called UNCONDITIONALLY on launch (NOT gated on operator auth): the dead-man wakes an
 * idle device-owner phone regardless of login, and the check-in it triggers is public.
 * Idempotent (re-registering the same task is a safe no-op) and best-effort (a failure
 * here — e.g. missing FCM credentials in a dev build — never blocks launch).
 */
export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(REMOTE_NOTIFICATION_TASK);
  } catch (err) {
    if (__DEV__)
      console.warn(
        '[StrawBoss] registerTaskAsync failed:',
        err instanceof Error ? err.message : String(err),
      );
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
