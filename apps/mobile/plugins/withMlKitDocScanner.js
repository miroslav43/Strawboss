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
const META_DATA_VALUE = 'docscanner';

module.exports = function withMlKitDocScanner(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      META_DATA_NAME,
      META_DATA_VALUE,
    );

    return cfg;
  });
};
