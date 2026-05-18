import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { PhotoCapture } from './PhotoCapture';
import { useOcrScan, type OcrMode, type OcrSuggestion } from '@/lib/ocr';
import { colors } from '@strawboss/ui-tokens';

interface OcrPhotoCaptureProps {
  /** Which parser to run on the captured photo. */
  mode: OcrMode;
  label?: string;
  /**
   * Called once the photo is captured and OCR has finished. `suggestion` may
   * be empty when nothing could be read — the caller falls back to manual entry.
   */
  onResult: (uri: string, suggestion: OcrSuggestion) => void;
}

/**
 * Photo capture + on-device OCR. Wraps the shared PhotoCapture: after a photo
 * is taken it runs OCR for `mode`, shows a "reading…" indicator, then hands the
 * URI and parsed suggestion back to the caller.
 */
export function OcrPhotoCapture({ mode, label, onResult }: OcrPhotoCaptureProps) {
  const { scanning, scan } = useOcrScan();

  const handleCapture = async (uri: string) => {
    const suggestion = await scan(uri, mode);
    onResult(uri, suggestion);
  };

  return (
    <View style={styles.container}>
      <PhotoCapture label={label} onCapture={(uri) => void handleCapture(uri)} />
      {scanning && (
        <View style={styles.scanning}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.scanningText}>Se citește poza…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  scanning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanningText: {
    fontSize: 14,
    color: colors.neutral,
  },
});
