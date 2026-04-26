import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { scale } from '@/utils/responsive';
import { colors } from '@strawboss/ui-tokens';

const FRAME_SIZE = Math.min(scale(250), 280);

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const router = useRouter();

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      // Expected QR format: strawboss://trip/<tripId> or strawboss://operation/<type>/<id>
      const url = new URL(data);
      if (url.protocol === 'strawboss:') {
        const parts = url.pathname.replace(/^\/\//, '').split('/');
        if (parts[0] === 'trip' && parts[1]) {
          router.push(`/trip/${parts[1]}`);
          return;
        }
      }
    } catch {
      // Not a URL, try as plain trip ID
    }

    // Treat as raw trip ID
    if (data.length > 0) {
      Alert.alert('Scanned', `Code: ${data}`, [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    } else {
      setScanned(false);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.message}>Camera access is required to scan QR codes</Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          <View style={[styles.scanFrame, { width: FRAME_SIZE, height: FRAME_SIZE }]} />
          <Text style={styles.scanText}>
            Point camera at a StrawBoss QR code
          </Text>
        </View>
      </View>

      {scanned && (
        <TouchableOpacity
          style={styles.rescanButton}
          onPress={() => setScanned(false)}
        >
          <Text style={styles.buttonText}>Scan Again</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraContainer: {
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
  },
  scanFrame: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: scale(12),
    backgroundColor: 'transparent',
  },
  scanText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 24,
    textAlign: 'center',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  message: {
    fontSize: 16,
    color: colors.neutral,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  rescanButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    alignItems: 'center',
  },
});
