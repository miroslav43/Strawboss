/**
 * T6 exit — Production entry screen.
 *
 * Reached when the baler exits a parcel geofence and the server sends a
 * `field_exit_production` push. The push lands on the `baler-exit` Android
 * notification channel (loud horn + vibration). Foreground reinforcement on
 * mount is via haptics (expo-av is not currently in the bundle; the loud
 * channel sound is the primary auditory cue).
 *
 * UX: large numeric keypad for bale count → Partial / Total picker → submit.
 * The Trimite button is disabled until the operator picks a finish state so
 * we never silently default the parcel to `harvested` when it was actually
 * partially done (T7 — no automatic downgrades, but also no fake upgrades).
 */

import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { BigButton } from '@/components/ui/BigButton';
import { NumericPad } from '@/components/ui/NumericPad';
import {
  HarvestFinishPicker,
  type HarvestFinishValue,
} from '@/components/features/production/HarvestFinishPicker';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';

export default function ProductionEntryScreen() {
  const params = useLocalSearchParams<{
    assignmentId?: string;
    parcelCode?: string;
    parcelId?: string;
    parcelName?: string;
  }>();
  const assignmentId = params.assignmentId ?? '';
  const parcelCode = params.parcelCode ?? '';

  const [count, setCount] = useState('');
  const [finish, setFinish] = useState<HarvestFinishValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Foreground reinforcement on mount — warning haptic so the operator
  // notices immediately even if they had the phone face-down.
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (Platform.OS === 'ios') {
      // iOS lacks the loud channel; fire an extra impact for redundancy.
      const t = setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, 250);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!finish) {
      // Defensive — the button should already be disabled.
      setError('Alege Parțial sau Total înainte de a trimite.');
      return;
    }
    if (!assignmentId) {
      setError('Lipsește identificatorul sarcinii.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parsed = parseInt(count, 10);
      const baleCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      await mobileApiClient.post('/api/v1/notifications/confirm-parcel-done', {
        assignmentId,
        baleCount,
        finishState: finish,
      });
      mobileLogger.flow('Production entry submitted', {
        assignmentId,
        baleCount,
        finishState: finish,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(baler)');
    } catch (err) {
      mobileLogger.flow('Production entry submit failed', {
        assignmentId,
        err: err instanceof Error ? err.message : String(err),
      });
      setError('Nu s-a putut trimite. Verifică legătura și încearcă din nou.');
    } finally {
      setSaving(false);
    }
  }, [assignmentId, count, finish]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  const submitDisabled = !finish || saving || !assignmentId;

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader
        title={parcelCode ? `Producție — ${parcelCode}` : 'Producție'}
        onBack={handleBack}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Câți baloți ai produs?</Text>
          <NumericPad value={count} onChange={setCount} maxLength={4} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Cum ai finalizat câmpul?</Text>
          <HarvestFinishPicker value={finish} onChange={setFinish} />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <BigButton
          title={saving ? 'Se trimite…' : 'Trimite'}
          onPress={handleSubmit}
          disabled={submitDisabled}
          loading={saving}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A5C36',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
});
