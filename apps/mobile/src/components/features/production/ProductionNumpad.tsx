import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { UndoToast } from '@/components/shared/UndoToast';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@strawboss/ui-tokens';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { fontScale } from '@/utils/responsive';
import { generateUuid } from '@/lib/uuid';
import { todayInRomania } from '@/lib/date';
import { useMyTasks } from '@/hooks/useMyTasks';
import { operatorStatsQueryKey } from '@/components/features/stats/OperatorStats';
import { useUndoableSave } from '@/hooks/useUndoableSave';
import {
  useActiveParcels,
  findParcelAtLocation,
  type ActiveParcel,
} from '@/hooks/useActiveParcels';

interface ProductionNumpadProps {
  operatorId: string;
  balerId: string | null;
}

type PadKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | 'clear' | 'backspace';

type ParcelSource = 'gps' | 'task' | null;
type GpsStatus = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ok';

const PAD_ROWS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'backspace'],
];

const MAX_DIGITS = 5;
const GPS_REFRESH_MS = 45_000;
// Cap how long we wait for a fix so the screen never sits in "loading" forever
// on a cold/weak GPS. Balanced accuracy resolves much faster than High and is
// plenty for parcel-polygon matching.
const GPS_FIX_TIMEOUT_MS = 12_000;

export function ProductionNumpad({ operatorId, balerId }: ProductionNumpadProps) {
  const { tasks } = useMyTasks();
  const queryClient = useQueryClient();
  const { modalProps, showModal, hideModal } = useModal();
  const parcelQuery = useActiveParcels();
  const activeParcels: ActiveParcel[] | undefined = parcelQuery.data as ActiveParcel[] | undefined;
  const parcelsLoading = parcelQuery.isLoading;
  const parcelsError = parcelQuery.isError;

  const [count, setCount] = useState('');
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [parcelName, setParcelName] = useState<string | null>(null);
  const [parcelCode, setParcelCode] = useState<string | null>(null);
  const [parcelSource, setParcelSource] = useState<ParcelSource>(null);

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [lastLonLat, setLastLonLat] = useState<{ lon: number; lat: number } | null>(null);
  const [lastAccuracyM, setLastAccuracyM] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);

  const taskOnlyParcel = useMemo(() => {
    const withParcel = tasks.filter((t) => t.parcelId !== null && t.parcelName !== null);
    const uniqueIds = new Set(withParcel.map((t) => t.parcelId));
    if (uniqueIds.size !== 1) return null;
    const first = withParcel[0];
    if (!first?.parcelId || !first.parcelName) return null;
    return { id: first.parcelId, name: first.parcelName };
  }, [tasks]);

  const gpsHit = useMemo(() => {
    if (gpsStatus !== 'ok' || !lastLonLat || !activeParcels?.length) return null;
    return findParcelAtLocation(lastLonLat.lon, lastLonLat.lat, activeParcels);
  }, [gpsStatus, lastLonLat, activeParcels]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      async function sample(showLoading: boolean) {
        if (showLoading) setGpsStatus('loading');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (status !== 'granted') {
          setGpsStatus('denied');
          setLastLonLat(null);
          setLastAccuracyM(null);
          return;
        }
        try {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('GPS timeout')), GPS_FIX_TIMEOUT_MS),
            ),
          ]);
          if (!alive) return;
          setLastLonLat({
            lon: loc.coords.longitude,
            lat: loc.coords.latitude,
          });
          setLastAccuracyM(
            loc.coords.accuracy != null && Number.isFinite(loc.coords.accuracy)
              ? loc.coords.accuracy
              : null,
          );
          setGpsStatus('ok');
        } catch {
          if (!alive) return;
          setGpsStatus('unavailable');
          setLastLonLat(null);
          setLastAccuracyM(null);
        }
      }

      void sample(true);
      const intervalId = setInterval(() => {
        void sample(false);
      }, GPS_REFRESH_MS);

      return () => {
        alive = false;
        clearInterval(intervalId);
      };
    }, []),
  );

  useEffect(() => {
    if (!activeParcels || activeParcels.length === 0) return;

    if (gpsHit) {
      setParcelId(gpsHit.id);
      setParcelName(gpsHit.name);
      setParcelCode(gpsHit.code || null);
      setParcelSource('gps');
      return;
    }

    const gpsSaysOutsideAllParcels = gpsStatus === 'ok' && activeParcels.length > 0 && !gpsHit;

    if (taskOnlyParcel && !gpsSaysOutsideAllParcels) {
      const meta = activeParcels.find((p) => p.id === taskOnlyParcel.id);
      setParcelId(taskOnlyParcel.id);
      setParcelName(taskOnlyParcel.name);
      setParcelCode(meta?.code ?? null);
      setParcelSource('task');
      return;
    }

    if (gpsStatus === 'ok' || gpsStatus === 'denied' || gpsStatus === 'unavailable') {
      setParcelId(null);
      setParcelName(null);
      setParcelCode(null);
      setParcelSource(null);
    }
  }, [activeParcels, taskOnlyParcel, gpsHit, gpsStatus]);

  // FM-4: undo hook — deletes the bale_productions row + sync queue entry
  const { showUndo, toastState } = useUndoableSave({
    onDeleteLocal: async (entityId) => {
      const db = await getDatabase();
      const repo = new BaleProductionsRepo(db);
      await repo.deleteLocal(entityId);
      void queryClient.invalidateQueries({ queryKey: ['bale-productions'] });
      void queryClient.invalidateQueries({ queryKey: operatorStatsQueryKey(operatorId) });
    },
  });

  const subtitle = useMemo(() => {
    if (parcelSource === 'gps') {
      const acc =
        lastAccuracyM != null && lastAccuracyM > 0 ? ` (~±${Math.round(lastAccuracyM)} m)` : '';
      return `Detectat din GPS${acc}`;
    }
    if (parcelSource === 'task') {
      return 'Din planul zilei';
    }
    if (gpsStatus === 'loading') {
      return 'Se detectează locația…';
    }
    if (gpsStatus === 'denied') {
      return 'GPS refuzat — acordă permisiunea de locație';
    }
    if (gpsStatus === 'unavailable') {
      return 'GPS indisponibil — încearcă din nou pe teren';
    }
    if (gpsStatus === 'ok' && lastLonLat) {
      return 'În afara terenurilor delimitate — apropie-te de teren';
    }
    return 'Se detectează terenul din GPS…';
  }, [parcelSource, gpsStatus, lastLonLat, lastAccuracyM]);

  const bannerMainTitle = useMemo(() => {
    if (parcelName) return parcelName;
    if (gpsStatus === 'ok' && activeParcels && activeParcels.length > 0 && !gpsHit) {
      return 'Nu ești pe niciun teren delimitat';
    }
    return '—';
  }, [parcelName, gpsStatus, activeParcels, gpsHit]);

  const handlePress = useCallback((key: PadKey) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === 'backspace') {
      setCount((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      setCount('');
      return;
    }
    setCount((prev) => {
      if (prev.length >= MAX_DIGITS) return prev;
      if (prev === '' && key === '0') return prev;
      return prev + key;
    });
  }, []);

  const numericCount = useMemo(() => {
    const n = parseInt(count, 10);
    return Number.isFinite(n) ? n : 0;
  }, [count]);

  const canSave = !saving && numericCount > 0 && parcelId !== null;

  const doSave = useCallback(async () => {
    if (!canSave || parcelId === null) return;
    setSaving(true);
    mobileLogger.flow('Baler production: saving local record', {
      parcelId,
      baleCount: numericCount,
    });
    try {
      const db = await getDatabase();
      const productionsRepo = new BaleProductionsRepo(db);
      const syncQueue = new SyncQueueRepo(db);

      const id = generateUuid();
      const now = new Date().toISOString();
      const productionDate = todayInRomania();

      await productionsRepo.create({
        id,
        parcel_id: parcelId,
        baler_id: balerId,
        operator_id: operatorId,
        production_date: productionDate,
        bale_count: numericCount,
        avg_bale_weight_kg: null,
        start_time: null,
        end_time: now,
        created_at: now,
        updated_at: now,
        server_version: 0,
      });

      await syncQueue.enqueue({
        entityType: 'bale_productions',
        entityId: id,
        action: 'insert',
        payload: {
          id,
          parcel_id: parcelId,
          baler_id: balerId,
          operator_id: operatorId,
          production_date: productionDate,
          bale_count: numericCount,
          end_time: now,
        },
        idempotencyKey: `bale_productions_${id}`,
      });

      mobileLogger.flow('Baler production: queued for sync', { parcelId, id });
      void queryClient.invalidateQueries({ queryKey: ['bale-productions'] });
      void queryClient.invalidateQueries({
        queryKey: operatorStatsQueryKey(operatorId),
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCount('');

      // FM-4: show undo toast
      showUndo({
        entityId: id,
        idempotencyKey: `bale_productions_${id}`,
        label: `Înregistrat — ${numericCount} baloți`,
      });
    } catch (err) {
      mobileLogger.error('Baler production: save failed', {
        parcelId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      showModal({
        type: 'error',
        title: 'Eroare',
        message: err instanceof Error ? err.message : 'Nu s-a putut salva producția',
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    parcelId,
    balerId,
    operatorId,
    numericCount,
    queryClient,
    showUndo,
    showModal,
    hideModal,
  ]);

  // FM-5: duplicate detection — check for existing production on same (parcelId, date)
  const handleSave = useCallback(async () => {
    if (!canSave || parcelId === null) return;
    try {
      const db = await getDatabase();
      const productionsRepo = new BaleProductionsRepo(db);
      const productionDate = todayInRomania();
      const existing = await productionsRepo.findByParcelAndDate(parcelId, productionDate);
      if (existing.length > 0) {
        const totalExisting = existing.reduce((acc, p) => acc + p.bale_count, 0);
        const minutesAgo = Math.round(
          (Date.now() - new Date(existing[0]!.created_at).getTime()) / 60_000,
        );
        showModal({
          type: 'warning',
          title: 'Producție deja înregistrată',
          message: `Ai înregistrat deja ${totalExisting} baloți pe acest teren azi (acum ${minutesAgo} min). Continui cu o nouă înregistrare?`,
          confirmText: 'Da, continuă',
          cancelText: 'Anulează',
          onConfirm: () => {
            hideModal();
            void doSave();
          },
          onCancel: hideModal,
        });
        return;
      }
    } catch {
      // Non-fatal — proceed with save even if duplicate check fails
    }
    await doSave();
  }, [canSave, parcelId, showModal, hideModal, doSave]);

  return (
    <View style={styles.container}>
      <View style={styles.parcelSection}>
        <Text style={styles.parcelLabel}>Teren</Text>

        {parcelsError ? (
          <Text style={styles.bannerError}>
            Nu s-au putut încărca parcelele. Verifică conexiunea.
          </Text>
        ) : parcelsLoading && (activeParcels === undefined || activeParcels.length === 0) ? (
          <View style={styles.bannerLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.bannerLoadingText}>Încarc parcelele…</Text>
          </View>
        ) : (
          <View style={styles.bannerCard}>
            <View style={styles.bannerTitleRow}>
              <MaterialCommunityIcons
                name="map-marker-radius"
                size={18}
                color={colors.primary}
                style={styles.bannerIcon}
              />
              <View style={styles.bannerTitleTextWrap}>
                <Text style={styles.bannerTitle} numberOfLines={2}>
                  {bannerMainTitle}
                </Text>
                {parcelCode ? <Text style={styles.bannerCode}>{parcelCode}</Text> : null}
              </View>
            </View>
            <Text style={styles.bannerSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.display}>
        <Text style={styles.displayNumber}>{count || '0'}</Text>
        <Text style={styles.displayLabel}>baloți</Text>
      </View>

      <View style={styles.pad}>
        {PAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => {
              const isAction = key === 'clear' || key === 'backspace';
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.key, isAction && styles.actionKey]}
                  onPress={() => handlePress(key)}
                  activeOpacity={0.6}
                  accessibilityLabel={
                    key === 'backspace'
                      ? 'Șterge ultima cifră'
                      : key === 'clear'
                        ? 'Șterge tot'
                        : key
                  }
                >
                  {key === 'backspace' ? (
                    <MaterialCommunityIcons
                      name="backspace-outline"
                      size={32}
                      color={colors.neutral}
                    />
                  ) : key === 'clear' ? (
                    <Text style={[styles.keyText, styles.actionKeyText]}>C</Text>
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <UndoToast state={toastState} bottomOffset={80} />

      <TouchableOpacity
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText} numberOfLines={1}>
          {saving ? 'Se salvează…' : 'SALVEAZĂ PRODUCȚIE'}
        </Text>
      </TouchableOpacity>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  parcelSection: {
    gap: 6,
    flexShrink: 0,
  },
  parcelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral100,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  bannerIcon: {
    marginTop: 2,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bannerTitleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.black,
    lineHeight: 20,
  },
  bannerCode: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral,
    letterSpacing: 0.2,
  },
  bannerSubtitle: {
    fontSize: 11,
    color: colors.neutral,
    lineHeight: 14,
  },
  bannerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  bannerLoadingText: {
    fontSize: 13,
    color: colors.neutral,
  },
  bannerError: {
    fontSize: 14,
    color: colors.danger,
    paddingVertical: 8,
  },
  display: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flexShrink: 0,
  },
  displayNumber: {
    fontSize: fontScale(76),
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 82,
    letterSpacing: -1,
  },
  displayLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
    marginTop: -4,
    letterSpacing: 0.5,
  },
  pad: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 0,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    height: 56,
  },
  key: {
    flex: 1,
    height: '100%',
    backgroundColor: colors.white,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  actionKey: {
    backgroundColor: colors.surface,
  },
  keyText: {
    fontSize: fontScale(36),
    fontWeight: '700',
    color: colors.black,
  },
  actionKeyText: {
    fontSize: 30,
    color: colors.neutral,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  saveButtonDisabled: {
    backgroundColor: colors.neutral200,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: fontScale(18),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
