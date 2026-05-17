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
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';
import { colors } from '@strawboss/ui-tokens';
import { useQueryClient } from '@tanstack/react-query';

type Step = 'odometer' | 'signature';

export default function DepartureFlowScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('odometer');
  const [odometerStr, setOdometerStr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const odometerKm = parseFloat(odometerStr);
  const odometerValid = !isNaN(odometerKm) && odometerKm >= 0;

  const handleOdometerNext = useCallback(() => {
    if (!odometerValid) {
      Alert.alert('Eroare', 'Introduceți kilometrajul de plecare.');
      return;
    }
    setStep('signature');
  }, [odometerValid]);

  const handleSignature = useCallback(async (driverSignature: string) => {
    if (!tripId) return;
    setSubmitting(true);
    try {
      await mobileApiClient.post(`/api/v1/trips/${tripId}/depart`, {
        departureOdometerKm: odometerKm,
        driverSignature,
      });

      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip-alert', tripId] });

      mobileLogger.flow('DepartureFlow: depart success', { tripId });

      router.replace('/(driver)');
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
  }, [tripId, odometerKm, queryClient]);

  if (step === 'signature') {
    return (
      <View style={styles.outer}>
        <ScreenHeader title="Semnătură șofer" />
        <View style={[styles.body, { flex: 1 }]}>
          <View style={styles.infoRow}>
            <MaterialCommunityIcons name="counter" size={18} color={colors.primary} />
            <Text style={styles.infoText}>Km plecare: <Text style={styles.infoValue}>{odometerStr}</Text></Text>
          </View>
          <Text style={styles.sigHint}>
            Semnează pentru a confirma plecarea și a genera documentul CMR.
          </Text>
          <SignatureCapture
            label="Semnătura șoferului"
            onSave={(sig) => void handleSignature(sig)}
          />
          {submitting ? null : (
            <BigButton
              title="Înapoi"
              onPress={() => setStep('odometer')}
              variant="outline"
            />
          )}
        </View>
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
        <BigButton
          title="Anulează"
          onPress={() => router.back()}
          variant="outline"
        />
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
  infoText: { fontSize: 15, color: '#5D4037' },
  infoValue: { fontWeight: '700', color: '#0A5C36' },
  sigHint: { fontSize: 14, color: '#5D4037', paddingHorizontal: 16, paddingBottom: 8 },
});
