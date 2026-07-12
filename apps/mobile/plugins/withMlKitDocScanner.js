/**
 * Expo config plugin: pre-fetch the ML Kit document-scanner module (Android).
 *
 * The scanner used by `react-native-document-scanner-plugin` is not bundled in the
 * APK — it is a Google Play Services module downloaded on demand. Left alone, the
 * download happens on the FIRST scan, which for a loader is exactly the moment
 * they are standing in a field with no signal.
 *
 * The `com.google.mlkit.vision.DEPENDENCIES` meta-data asks Play Services to fetch
 * the module as soon as the app is installed, so by the time anyone scans, it is
 * already there.
 *
 * This is best-effort, not a guarantee: it needs healthy Play Services and it does
 * nothing on a device that is offline at install time (which is the normal case for
 * our sideloaded Device-Owner fleet). So the scanner call site ALSO has to degrade
 * gracefully — see `scanCmrPages()` in src/lib/cmrScanUpload.ts, which falls back to
 * a plain camera capture when the module is unavailable.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const META_DATA_NAME = 'com.google.mlkit.vision.DEPENDENCIES';
// expo-camera's own AndroidManifest.xml declares this same meta-data key with
// value "barcode_ui" (its ML Kit barcode module). The value is a comma-separated
// list of ML Kit modules for Play Services to pre-fetch, so we combine ours with
// theirs instead of letting the two collide during the Gradle manifest merge —
// see the "Manifest merger failed" error this used to throw on assembleRelease.
const META_DATA_VALUE = 'docscanner,barcode_ui';

module.exports = function withMlKitDocScanner(config) {
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      META_DATA_NAME,
      META_DATA_VALUE,
    );

    // Tell the merger to keep our (combined) value over expo-camera's
    // library-manifest value instead of erroring on the mismatch.
    const item = application['meta-data'].find((e) => e.$['android:name'] === META_DATA_NAME);
    item.$['tools:replace'] = 'android:value';

    return cfg;
  });
};
