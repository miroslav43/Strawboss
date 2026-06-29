// Custom bundle entry.
//
// Register the headless background tasks at the TRUE entry point — before the Expo
// Router mounts — so they exist in COLD HEADLESS starts: i.e. after the OS kills the
// process (OTA self-update, reboot, low-memory) and `BootReceiver` or the presence
// alarm spin up a fresh JS runtime with NO Activity. Previously these were imported
// only from `app/_layout.tsx` (a router screen), so a headless runtime loaded the
// bundle but never ran the router → "No task registered for key strawboss-boot-rearm"
// → the phone never recovered its foreground services after an update/reboot.
//
// Keep this import FIRST, then hand off to the normal Expo Router entry.
import './src/lib/register-background-tasks';
import 'expo-router/entry';
