import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { BigButton } from '@/components/ui/BigButton';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { PendingTransitionBadge } from '@/components/shared/PendingTransitionBadge';
import { ConfirmCountdown } from '@/components/shared/ConfirmCountdown';
import { mobileLogger } from '@/lib/logger';
import { colors } from '@strawboss/ui-tokens';
import { useTripTransition } from '@/hooks/useTripTransition';
import { useAuthStore } from '@/stores/auth-store';
import { resolveApiUrl } from '@/lib/api-client';
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
  const signatureSpecimenUrl = useAuthStore((s) => s.signatureSpecimenUrl);

  const odometerKm = parseFloat(odometerStr);
  const odometerValid = !isNaN(odometerKm) && odometerKm >= 0;

  const handleOdometerNext = useCallback(() => {
    if (!odometerValid) {
      Alert.alert('Eroare', 'Introduceți kilometrajul de plecare.');
      return;
    }
    setStep('signature');
  }, [odometerValid]);

  // Sign-with-specimen: trigger countdown using the saved specimen URL instead
  // of capturing a fresh canvas signature.
  const handleSignWithSpecimen = useCallback(() => {
    if (!signatureSpecimenUrl) {
      // Defensive — should not happen because AuthGate forces specimen capture
      // for drivers before they can reach the trip flow.
      Alert.alert(
        'Specimen lipsă',
        'Nu ai încă un specimen de semnătură. Creează unul din profil.',
        [
          {
            text: 'Mergi la profil',
            onPress: () => router.replace('/specimen-capture?mode=redo'),
          },
        ],
      );
      return;
    }
    setPendingSignature(signatureSpecimenUrl);
    setCountdownVisible(true);
  }, [signatureSpecimenUrl]);

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
      // Specimen URL flows through verbatim — the backend stores it as-is in
      // `trips.driver_signature_url`, identical to how it handled freshly
      // captured base64 signatures before.
      const signatureValue = driverSignature;

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
        <ScrollView
          style={[styles.body, { flex: 1 }]}
          contentContainerStyle={styles.signatureContent}
        >
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
            Confirmă plecarea folosind specimenul de semnătură salvat.
          </Text>
          <View style={styles.specimenCard}>
            <Text style={styles.specimenLabel}>Specimen semnătură</Text>
            {signatureSpecimenUrl ? (
              <Image
                source={{ uri: resolveApiUrl(signatureSpecimenUrl) }}
                style={styles.specimenImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.specimenMissing}>Nu ai încă un specimen.</Text>
            )}
          </View>
          <BigButton
            title="Semnează cu specimen"
            onPress={handleSignWithSpecimen}
            disabled={submitting}
          />
          {submitting ? null : (
            <BigButton title="Înapoi" onPress={() => setStep('odometer')} variant="outline" />
          )}
        </ScrollView>
        {/* FM-6: countdown overlay — shown after specimen is selected */}
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
  signatureContent: { padding: 16, gap: 12 },
  specimenCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    alignItems: 'center',
  },
  specimenLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5D4037',
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
  },
  specimenImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#F9F5F2',
    borderRadius: 8,
  },
  specimenMissing: {
    fontSize: 14,
    color: '#C62828',
    paddingVertical: 24,
  },
});
