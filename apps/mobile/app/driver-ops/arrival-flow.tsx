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
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';
import { colors } from '@strawboss/ui-tokens';
import { useQueryClient } from '@tanstack/react-query';

export default function ArrivalFlowScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const queryClient = useQueryClient();

  const [odometerStr, setOdometerStr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const odometerKm = parseFloat(odometerStr);
  const odometerValid = !isNaN(odometerKm) && odometerKm >= 0;

  const handleSubmit = useCallback(async () => {
    if (!tripId) return;
    if (!odometerValid) {
      Alert.alert('Eroare', 'Introduceți kilometrajul la sosire.');
      return;
    }
    setSubmitting(true);
    try {
      await mobileApiClient.post(`/api/v1/trips/${tripId}/arrive`, {
        arrivalOdometerKm: odometerKm,
      });

      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trip-alert', tripId] });

      mobileLogger.flow('ArrivalFlow: arrive success', { tripId });
      router.replace('/(driver)');
    } catch (err) {
      mobileLogger.error('ArrivalFlow: arrive failed', {
        tripId,
        err: err instanceof Error ? err.message : String(err),
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut marca sosirea. Încearcă din nou.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [tripId, odometerKm, odometerValid, queryClient]);

  return (
    <KeyboardAvoidingView
      style={styles.outer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Sosire la destinație" />
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <MaterialCommunityIcons name="counter" size={24} color={colors.primary} />
          <Text style={styles.cardTitle}>Kilometraj la sosire</Text>
          <Text style={styles.cardHint}>
            Introduceți km afișați pe bord în momentul sosirii la destinație.
          </Text>
          <TextInput
            style={styles.input}
            value={odometerStr}
            onChangeText={setOdometerStr}
            keyboardType="decimal-pad"
            placeholder="ex: 123456"
            placeholderTextColor="#9CA3AF"
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmit()}
          />
        </View>

        <BigButton
          title="Confirmă sosirea"
          onPress={() => void handleSubmit()}
          disabled={!odometerValid}
          loading={submitting}
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
});
