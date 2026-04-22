import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@strawboss/ui-tokens';
import { ParcelSelector } from '@/components/shared/ParcelSelector';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { useMyTasks } from '@/hooks/useMyTasks';
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

type ParcelSource = 'gps' | 'task' | 'manual' | null;
type GpsStatus = 'idle' | 'loading' | 'denied' | 'unavailable' | 'ok';

const PAD_ROWS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'backspace'],
];

const MAX_DIGITS = 5;
const GPS_REFRESH_MS = 45_000;

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ProductionNumpad({ operatorId, balerId }: ProductionNumpadProps) {
  const { tasks } = useMyTasks();
  const queryClient = useQueryClient();
  const parcelQuery = useActiveParcels();
  const activeParcels: ActiveParcel[] | undefined =
    parcelQuery.data as ActiveParcel[] | undefined;
  const parcelsLoading = parcelQuery.isLoading;
  const parcelsError = parcelQuery.isError;

  const [count, setCount] = useState('');
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [parcelName, setParcelName] = useState<string | null>(null);
  const [parcelCode, setParcelCode] = useState<string | null>(null);
  const [parcelSource, setParcelSource] = useState<ParcelSource>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [lastLonLat, setLastLonLat] = useState<{ lon: number; lat: number } | null>(
    null,
  );
  const [lastAccuracyM, setLastAccuracyM] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
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
    if (manualOverride) return;
    if (!activeParcels || activeParcels.length === 0) return;

    if (gpsHit) {
      setParcelId(gpsHit.id);
      setParcelName(gpsHit.name);
      setParcelCode(gpsHit.code || null);
      setParcelSource('gps');
      return;
    }

    const gpsSaysOutsideAllParcels =
      gpsStatus === 'ok' &&
      activeParcels.length > 0 &&
      !gpsHit;

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
  }, [manualOverride, activeParcels, taskOnlyParcel, gpsHit, gpsStatus]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const subtitle = useMemo(() => {
    if (manualOverride) {
      return 'Selectat manual';
    }
    if (parcelSource === 'gps') {
      const acc =
        lastAccuracyM != null && lastAccuracyM > 0
          ? ` (~±${Math.round(lastAccuracyM)} m)`
          : '';
      return `Detectat din GPS${acc}`;
    }
    if (parcelSource === 'task') {
      return 'Din planul zilei';
    }
    if (gpsStatus === 'loading') {
      return 'Se detectează locația…';
    }
    if (gpsStatus === 'denied') {
      return 'GPS refuzat — alege manual sau acordă permisiunea';
    }
    if (gpsStatus === 'unavailable') {
      return 'GPS indisponibil — alege manual';
    }
    if (
      gpsStatus === 'ok' &&
      lastLonLat &&
      activeParcels &&
      activeParcels.length > 0 &&
      !gpsHit &&
      !manualOverride
    ) {
      return 'Alege manual din listă';
    }
    if (gpsStatus === 'ok' && lastLonLat) {
      return 'În afara parcelelor delimitate — alege manual';
    }
    return 'Alege terenul';
  }, [
    manualOverride,
    parcelSource,
    gpsStatus,
    lastLonLat,
    lastAccuracyM,
    activeParcels,
    gpsHit,
  ]);

  const bannerMainTitle = useMemo(() => {
    if (parcelName) return parcelName;
    if (
      !manualOverride &&
      gpsStatus === 'ok' &&
      activeParcels &&
      activeParcels.length > 0 &&
      !gpsHit
    ) {
      return 'Nu ești pe niciun teren delimitat';
    }
    return '—';
  }, [parcelName, manualOverride, gpsStatus, activeParcels, gpsHit]);

  const handlePress = useCallback((key: PadKey) => {
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

  const showToast = useCallback(
    (message: string) => {
      setToastMessage(message);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current);
      }
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }).start(() => setToastMessage(null));
      }, 1800);
    },
    [toastOpacity],
  );

  const numericCount = useMemo(() => {
    const n = parseInt(count, 10);
    return Number.isFinite(n) ? n : 0;
  }, [count]);

  const canSave = !saving && numericCount > 0 && parcelId !== null;

  const handleSave = useCallback(async () => {
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
      const productionDate = todayDateString();

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

      setCount('');
      showToast(`Înregistrat — ${numericCount} baloți`);
    } catch (err) {
      mobileLogger.error('Baler production: save failed', {
        parcelId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
      Alert.alert(
        'Eroare',
        err instanceof Error ? err.message : 'Nu s-a putut salva producția',
      );
    } finally {
      setSaving(false);
    }
  }, [canSave, parcelId, balerId, operatorId, numericCount, queryClient, showToast]);

  const onManualPick = useCallback(
    (id: string, name: string) => {
      setManualOverride(true);
      setParcelId(id);
      setParcelName(name);
      const meta = activeParcels?.find((p) => p.id === id);
      setParcelCode(meta?.code ?? null);
      setParcelSource('manual');
      setPickerOpen(false);
    },
    [activeParcels],
  );

  return (
    <View style={styles.container}>
      <View style={styles.parcelSection}>
        <Text style={styles.parcelLabel}>Teren</Text>

        {parcelsError ? (
          <Text style={styles.bannerError}>
            Nu s-au putut încărca parcelele. Verifică conexiunea.
          </Text>
        ) : parcelsLoading &&
          (activeParcels === undefined || activeParcels.length === 0) ? (
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
                {parcelCode ? (
                  <Text style={styles.bannerCode}>{parcelCode}</Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.bannerSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>

            {manualOverride ? (
              <TouchableOpacity
                style={styles.linkButtonInline}
                onPress={() => setManualOverride(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.linkButtonSecondaryText}>
                  Folosește din nou GPS
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        <TouchableOpacity
          style={styles.manualDropdownRow}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.7}
          disabled={parcelsLoading && (activeParcels === undefined || activeParcels.length === 0)}
        >
          {parcelsLoading && (activeParcels === undefined || activeParcels.length === 0) ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Text
                style={[
                  styles.manualDropdownText,
                  !parcelId && styles.manualDropdownPlaceholder,
                ]}
                numberOfLines={1}
              >
                {parcelName ?? 'Alege teren din listă…'}
              </Text>
              <Text style={styles.manualDropdownChevron}>{'›'}</Text>
            </>
          )}
        </TouchableOpacity>

        <ParcelSelector
          showTrigger={false}
          modalOpen={pickerOpen}
          onModalOpenChange={setPickerOpen}
          onSelect={onManualPick}
          selectedId={parcelId}
          selectedName={parcelName}
          parcels={activeParcels}
          isLoading={parcelsLoading}
          isError={parcelsError}
        />
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

      {toastMessage !== null && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.white} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      <TouchableOpacity
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Se salvează…' : 'SALVEAZĂ PRODUCȚIE'}
        </Text>
      </TouchableOpacity>
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
  linkButtonInline: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  linkButtonSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  manualDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  manualDropdownText: {
    flex: 1,
    fontSize: 15,
    color: colors.black,
    fontWeight: '500',
  },
  manualDropdownPlaceholder: {
    color: colors.neutral400,
    fontWeight: '400',
  },
  manualDropdownChevron: {
    fontSize: 20,
    color: colors.neutral400,
    fontWeight: '600',
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
    fontSize: 76,
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
    fontSize: 36,
    fontWeight: '700',
    color: colors.black,
  },
  actionKeyText: {
    fontSize: 30,
    color: colors.neutral,
  },
  toast: {
    position: 'absolute',
    bottom: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
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
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
