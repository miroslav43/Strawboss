import { useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { colors } from '@strawboss/ui-tokens';

interface QRScannerProps {
  onScan: (data: string) => void;
  instruction?: string;
}

export function QRScanner({ onScan, instruction }: QRScannerProps) {
  const [scanned, setScanned] = useState(false);
  const lastScanTime = useRef<number>(0);

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                const now = Date.now();
                if (now - lastScanTime.current < 1500) return;
                lastScanTime.current = now;
                setScanned(true);
                onScan(data);
              }
        }
      />
      <View style={styles.overlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.instruction}>
          {instruction ?? 'Scan QR code'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 3,
    borderColor: colors.primary,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  instruction: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
