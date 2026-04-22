import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { QRScanner } from '@/components/shared/QRScanner';
import { BigButton } from '@/components/ui/BigButton';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { ConnectionStatusBadge } from '@/components/shared/ConnectionStatusBadge';
import { ProblemReportModal } from '@/components/shared/ProblemReportModal';
import { useAuthStore } from '@/stores/auth-store';

export default function LoaderScanScreen() {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const [problemModalVisible, setProblemModalVisible] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScan = (data: string) => {
    setScanError(null);
    // Expected format: strawboss://truck/<truckId>
    const match = data.match(/strawboss:\/\/truck\/([a-zA-Z0-9-]+)/);
    if (match) {
      const truckId = match[1];
      router.push(`/loader-ops/load-bales?truckId=${truckId}`);
    } else {
      setScanError('Cod QR invalid. Scanați codul de pe camion.');
    }
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OfflineBanner />
        <View style={styles.headerSection}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>Scanează Camion</Text>
            <ConnectionStatusBadge />
          </View>
          <Text style={styles.subtitle}>
            Poziționați camera pe codul QR de pe camion
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
      >
        <View style={styles.scannerContainer}>
          <QRScanner onScan={handleScan} />
        </View>

        {scanError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{scanError}</Text>
          </View>
        ) : null}

        <View style={styles.divider}>
          <Text style={styles.dividerText}>sau</Text>
        </View>

        <BigButton
          title="Raportează problemă tehnică"
          onPress={() => setProblemModalVisible(true)}
          variant="outline"
        />
      </ScrollView>

      <ProblemReportModal
        visible={problemModalVisible}
        onClose={() => setProblemModalVisible(false)}
        machineId={assignedMachineId ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  scannerContainer: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#991B1B', fontSize: 13 },
  divider: { alignItems: 'center' },
  dividerText: { color: '#8D6E63', fontSize: 13 },
});
