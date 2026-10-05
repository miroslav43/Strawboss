import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii } from '@strawboss/ui-tokens';
import { serverNow } from '@strawboss/api';
import type { CreateMoistureReadingDto, MoistureReadingKind } from '@strawboss/types';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { AppModal } from '@/components/shared/AppModal';
import { BigButton, NumericPad } from '@/components/ui';
import { useModal } from '@/hooks/useModal';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSync } from '@/hooks/useSync';
import { useCachedParcels } from '@/hooks/useCachedParcels';
import { useCurrentLoaderParcel } from '@/hooks/useCurrentLoaderParcel';
import { getDatabase } from '@/lib/storage';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';

/** Percent with at most one decimal, strictly between 0 and 100. */
function parsePct(raw: string): number | null {
  if (!/^\d{1,2}(\.\d)?$/.test(raw)) return null;
  const v = Number(raw);
  return v > 0 && v < 100 ? v : null;
}

/** Best-effort fix: never blocks the save, never prompts for permission. */
async function readLastKnownFix(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Moisture reading entry (Meteo module): parcel + value in % + swath/bale.
 * Offline-first: queued as `meteo_reading_create` (direct REST, no local table).
 */
export default function MeteoMeasureScreen() {
  const { t } = useI18n();
  const { colors: themeColors } = useTheme();
  const { modalProps, showModal, hideModal } = useModal();
  const { isConnected } = useNetworkStatus();
  const { triggerSync } = useSync();
  const { parcels } = useCachedParcels();
  const current = useCurrentLoaderParcel();

  const [parcelId, setParcelId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<MoistureReadingKind>('swath');
  const [saving, setSaving] = useState(false);
  // Synchronous double-tap guard: `saving` only disables the button after a
  // re-render, and each tap would enqueue a NEW reading (fresh UUID). Stays set
  // after a successful save — the screen is leaving anyway.
  const savingRef = useRef(false);

  // Pre-select the field the operator is working on, once, without overriding a manual pick.
  useEffect(() => {
    if (parcelId === null && current.targetType === 'parcel' && current.parcelId) {
      setParcelId(current.parcelId);
    }
  }, [current.parcelId, current.targetType, parcelId]);

  const sortedParcels = useMemo(
    () => [...parcels].sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code)),
    [parcels],
  );

  const pct = parsePct(value);
  const canSave = !saving && parcelId !== null && pct !== null;

  const onSave = useCallback(async () => {
    if (savingRef.current || !canSave || parcelId === null || pct === null) return;
    savingRef.current = true;
    setSaving(true);
    const id = generateUuid();
    try {
      const fix = await readLastKnownFix();
      const payload: CreateMoistureReadingDto = {
        id,
        parcelId,
        measuredAt: new Date(serverNow()).toISOString(),
        moisturePct: pct,
        kind,
        lat: fix?.lat ?? null,
        lon: fix?.lon ?? null,
        source: 'mobile',
      };
      mobileLogger.flow('Meteo: saving moisture reading', { id, parcelId, kind, pct });
      const db = await getDatabase();
      await new SyncQueueRepo(db).enqueue({
        entityType: 'meteo_reading_create',
        entityId: id,
        action: 'insert',
        payload,
        idempotencyKey: `meteo_reading_${id}`,
      });
      mobileLogger.flow('Meteo: moisture reading queued for sync', { id });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const online = isConnected === true;
      if (online) void triggerSync().catch(() => {});
      showModal({
        type: 'success',
        title: t('meteo.saved'),
        message: online ? t('meteo.saved') : t('meteo.savedOffline'),
        autoDismiss: true,
        onConfirm: () => {
          hideModal();
          router.back();
        },
      });
    } catch (err) {
      savingRef.current = false;
      mobileLogger.error('Meteo: save failed', {
        id,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      showModal({
        type: 'error',
        title: t('meteo.errorTitle'),
        message: err instanceof Error ? err.message : t('meteo.saveFailed'),
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [canSave, parcelId, pct, kind, isConnected, triggerSync, showModal, hideModal, t]);

  return (
    <View style={styles.outer}>
      <ScreenHeader title={t('meteo.title')} onBack={() => router.back()}>
        <Text style={styles.subtitle}>{t('meteo.sub')}</Text>
      </ScreenHeader>

      <ScrollView
        style={[styles.body, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.label}>{t('meteo.parcel')}</Text>
        {sortedParcels.length === 0 ? (
          <Text style={styles.hint}>{t('meteo.noParcels')}</Text>
        ) : (
          <View style={styles.chips}>
            {sortedParcels.map((p) => {
              const selected = p.id === parcelId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setParcelId(p.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {p.name || p.code}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={styles.label}>{t('meteo.kind')}</Text>
        <View style={styles.kindRow}>
          {(['swath', 'bale'] as const).map((k) => {
            const selected = kind === k;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.kindBtn, selected && styles.chipSelected]}
                onPress={() => setKind(k)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <MaterialCommunityIcons
                  name={k === 'swath' ? 'grass' : 'cube-outline'}
                  size={22}
                  color={selected ? colors.white : colors.primary}
                />
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {t(k === 'swath' ? 'meteo.swath' : 'meteo.bale')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('meteo.value')}</Text>
        <NumericPad value={value} onChange={setValue} maxLength={4} decimal />
        {value !== '' && pct === null ? (
          <Text style={styles.error}>{t('meteo.invalid')}</Text>
        ) : null}

        <BigButton
          title={t('meteo.save')}
          onPress={() => void onSave()}
          disabled={!canSave}
          loading={saving}
        />
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.primary },
  subtitle: { fontSize: 15, color: 'rgba(255, 255, 255, 0.8)' },
  body: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { padding: 16, gap: 12 },
  label: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  hint: { fontSize: 14, color: colors.textSecondary },
  error: { fontSize: 14, color: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  chipTextSelected: { color: colors.white },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
});
