import { useState } from 'react';
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
 *
 * FM-18: when OCR returns no text, shows a "Nu am putut citi bonul. Introdu
 * manual." message so the operator knows to enter the value by hand.
 */
export function OcrPhotoCapture({ mode, label, onResult }: OcrPhotoCaptureProps) {
  const { scanning, scan } = useOcrScan();
  const [ocrFailed, setOcrFailed] = useState(false);

  const handleCapture = async (uri: string) => {
    setOcrFailed(false);
    const result = await scan(uri, mode);
    if (result.ocrFailed) {
      setOcrFailed(true);
    }
    onResult(uri, result.suggestion);
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
      {/* FM-18: explicit feedback when OCR found no text */}
      {!scanning && ocrFailed && (
        <View style={styles.failedBanner}>
          <Text style={styles.failedText}>Nu am putut citi bonul. Introdu manual.</Text>
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
  failedBanner: {
    backgroundColor: '#FFF3CD',
    borderWidth: 1,
    borderColor: '#FFC107',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  failedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    textAlign: 'center',
  },
});
