import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { BigButton } from '@/components/ui/BigButton';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { SignatureCapture } from '@/components/shared/SignatureCapture';
import { PendingTransitionBadge } from '@/components/shared/PendingTransitionBadge';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { mobileLogger } from '@/lib/logger';
import { uploadSignature } from '@/lib/signatureUpload';
import { colors } from '@strawboss/ui-tokens';
import { useTripTransition } from '@/hooks/useTripTransition';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';

type Step = 'odometer' | 'signature';

export default function DepartureFlowScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [step, setStep] = useState<Step>('odometer');
  const [odometerStr, setOdometerStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  // FM-6: countdown state
  const [countdownVisible, setCountdownVisible] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);

  const { enqueueTransition } = useTripTransition();

  const odometerKm = parseFloat(odometerStr);
  const odometerValid = !isNaN(odometerKm) && odometerKm >= 0;

  const handleOdometerNext = useCallback(() => {
    if (!odometerValid) {
      Alert.alert('Eroare', 'Introduceți kilometrajul de plecare.');
      return;
    }
    setStep('signature');
  }, [odometerValid]);

  // FM-6: called when the driver draws the signature — shows the countdown instead
  // of executing depart immediately.
  const handleSignatureCaptured = useCallback((sig: string) => {
    setPendingSignature(sig);
    setCountdownVisible(true);
  }, []);

  const handleCountdownCancel = useCallback(() => {
    setCountdownVisible(false);
    setPendingSignature(null);
  }, []);

  // Actual depart logic — runs after countdown expires (FM-6).
  const executeDepart = useCallback(async () => {
    setCountdownVisible(false);
    const driverSignature = pendingSignature;
    setPendingSignature(null);
    if (!tripId || !driverSignature) return;
    setSubmitting(true);
    try {
      // M9: Attempt binary upload of the signature PNG.  On success the body
      // will carry the server URL; on any error (offline / server failure) we
      // fall back to sending the raw base64 string — the backend accepts both.
      let signatureValue = driverSignature;
      try {
        signatureValue = await uploadSignature(driverSignature, 'driver');
        mobileLogger.flow('DepartureFlow: driver signature uploaded as binary', { tripId });
      } catch {
        // Offline or upload error — fall back to base64 (backward-compatible).
        mobileLogger.info('DepartureFlow: signature binary upload failed, falling back to base64', {
          tripId,
        });
      }

      // Read current local trip status for pre-validation.
      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const trip = await tripsRepo.findById(tripId);
      const currentStatus = trip?.status ?? 'loaded';

      await enqueueTransition({
        tripId,
        currentStatus,
        transition: 'depart',
        body: {
          departureOdometerKm: odometerKm,
          driverSignature: signatureValue,
        },
        localMeta: {
          departure_odometer_km: odometerKm,
          departure_at: new Date().toISOString(),
        },
      });

      mobileLogger.flow('DepartureFlow: depart enqueued offline-first', { tripId });
      setPendingSync(true);

      // Navigate immediately — the local state is already updated.
      router.replace(`/trip/${tripId}`);
    } catch (err) {
      mobileLogger.error('DepartureFlow: depart failed', {
        tripId,
        err: err instanceof Error ? err.message : String(err),
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut porni cursa. Încearcă din nou.',
      );
      setStep('odometer');
    } finally {
      setSubmitting(false);
    }
  }, [tripId, odometerKm, enqueueTransition, pendingSignature]);

  if (step === 'signature') {
    return (
      <View style={styles.outer}>
        <ScreenHeader title="Semnătură șofer" />
        <View style={[styles.body, { flex: 1 }]}>
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="counter" size={18} color={colors.primary} />
            <Text style={styles.infoText}>
              Km plecare: <Text style={styles.infoValue}>{odometerStr}</Text>
            </Text>
          </View>
          {pendingSync && (
            <View style={styles.badgeRow}>
              <PendingTransitionBadge />
            </View>
          )}
          <Text style={styles.sigHint}>
            Semnează pentru a confirma plecarea și a genera documentul CMR.
          </Text>
          <SignatureCapture label="Semnătura șoferului" onSave={handleSignatureCaptured} />
          {submitting ? null : (
            <BigButton title="Înapoi" onPress={() => setStep('odometer')} variant="outline" />
          )}
        </View>
        {/* FM-6: countdown overlay — shown after signature is captured */}
        <ConfirmCountdown
          visible={countdownVisible}
          actionLabel="Plecare din câmp"
          countdownSeconds={3}
          onConfirmed={() => void executeDepart()}
          onCancel={handleCountdownCancel}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.outer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Plecare din câmp" />
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <MaterialCommunityIcons name="counter" size={24} color={colors.primary} />
          <Text style={styles.cardTitle}>Kilometraj la plecare</Text>
          <Text style={styles.cardHint}>Introduceți km afișați pe bord în momentul plecării.</Text>
          <TextInput
            style={styles.input}
            value={odometerStr}
            onChangeText={setOdometerStr}
            keyboardType="decimal-pad"
            placeholder="ex: 123456"
            placeholderTextColor="#9CA3AF"
            returnKeyType="next"
            onSubmitEditing={handleOdometerNext}
          />
        </View>

        <BigButton
          title="Continuă — Semnează"
          onPress={handleOdometerNext}
          disabled={!odometerValid}
        />
        <BigButton title="Anulează" onPress={() => router.back()} variant="outline" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.primary },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#0A5C36' },
  cardHint: { fontSize: 13, color: '#5D4037' },
  input: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 20,
    fontWeight: '700',
    color: '#0A5C36',
    marginTop: 4,
    backgroundColor: '#F9FFF9',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    paddingBottom: 4,
  },
  badgeRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  infoText: { fontSize: 15, color: '#5D4037' },
  infoValue: { fontWeight: '700', color: '#0A5C36' },
  sigHint: { fontSize: 14, color: '#5D4037', paddingHorizontal: 16, paddingBottom: 8 },
});
