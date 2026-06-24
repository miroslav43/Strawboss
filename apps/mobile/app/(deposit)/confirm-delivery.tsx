import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useI18n } from '@/lib/i18n';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BigButton } from '@/components/ui/BigButton';
import { NumericPad } from '@/components/ui/NumericPad';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { SignatureCapture } from '@/components/shared/SignatureCapture';
import { AppModal } from '@/components/shared/AppModal';
import { useModal } from '@/hooks/useModal';
import { useDepotInventory, useDepotList } from '@/hooks/useDepotInventory';
import { useSync } from '@/hooks/useSync';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { SyncQueueRepo } from '@/db/sync-queue-repo';
import { uploadSignature } from '@/lib/signatureUpload';
import { mobileLogger } from '@/lib/logger';
import { generateUuid } from '@/lib/uuid';
import { colors } from '@strawboss/ui-tokens';
import type { TripTransitionPayload } from '@/sync/push';

/**
 * Plan C — depot operator delivery confirmation screen.
 *
 * Flow:
 *  1. Resolve the inbound truck from useDepotInventory incoming[].
 *  2. Gate confirmation on isInsideGeofence.
 *  3. Collect bale count (NumericPad, prefilled from server data).
 *  4. If principal depot: collect gross + tare weights (or use scale-broken toggle).
 *  5. Collect operator signature (SignatureCapture).
 *  6. Enqueue a `trip_transition` sync queue entry with transition `confirm-depot-delivery`.
 *  7. Apply optimistically locally (applyTransitionLocally → completed).
 *  8. Kick sync + invalidate queries, then navigate back.
 */

export default function ConfirmDeliveryScreen() {
  const { t } = useI18n();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  // Resolve depot context the same way index.tsx and trips.tsx do.
  const { data: depots } = useDepotList();
  const depotId = depots?.[0]?.id ?? null;
  const inventoryQuery = useDepotInventory(depotId);
  const payload = inventoryQuery.data;

  const incoming = payload?.incoming ?? [];
  const truck = incoming.find((t) => t.tripId === tripId) ?? null;
  const depot = payload?.depot ?? null;

  // --- form state ---
  const [baleCountStr, setBaleCountStr] = useState<string>('');
  const [grossWeightStr, setGrossWeightStr] = useState('');
  const [tareWeightStr, setTareWeightStr] = useState('');
  const [scaleBroken, setScaleBroken] = useState(false);
  const [activeWeightField, setActiveWeightField] = useState<'gross' | 'tare'>('gross');
  const [signature, setSignature] = useState<string | null>(null);
  const [showSignatureCapture, setShowSignatureCapture] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const successScale = useRef(new Animated.Value(0.5)).current;

  const queryClient = useQueryClient();
  const { triggerSync } = useSync();
  const { modalProps, showModal, hideModal } = useModal();

  // Prefill bale count from the truck's known value once data loads.
  useEffect(() => {
    if (truck && baleCountStr === '') {
      setBaleCountStr(String(truck.baleCount > 0 ? truck.baleCount : ''));
    }
  }, [truck, baleCountStr]);

  // Derived values
  const baleCount = parseInt(baleCountStr, 10) || 0;
  const grossWeightKg = parseFloat(grossWeightStr) || 0;
  const tareWeightKg = parseFloat(tareWeightStr) || 0;
  const netWeightKg = Math.max(0, grossWeightKg - tareWeightKg);

  const isPrincipal = depot?.depotType === 'principal';
  const isInsideGeofence = truck?.isInsideGeofence ?? false;
  const distanceM = truck?.distanceM ?? null;

  // Validation
  const baleCountValid = baleCount > 0;
  const weightsValid =
    !isPrincipal ||
    scaleBroken ||
    (grossWeightStr.length > 0 &&
      grossWeightKg > 0 &&
      tareWeightStr.length > 0 &&
      tareWeightKg >= 0 &&
      tareWeightKg <= grossWeightKg &&
      netWeightKg > 0);
  const signatureReady = signature !== null;
  const canSubmit = baleCountValid && weightsValid && signatureReady && isInsideGeofence && !saving;

  const handleSubmit = useCallback(async () => {
    if (!tripId || !truck) return;
    if (!isInsideGeofence) {
      showModal({
        type: 'warning',
        title: t('confirmDelivery.modalGeofenceTitle'),
        message:
          distanceM != null
            ? t('confirmDelivery.modalGeofenceMessageWithDistance', { distance: distanceM })
            : t('confirmDelivery.modalGeofenceMessageNoPosition'),
        confirmText: t('confirmDelivery.modalGeofenceConfirm'),
        onConfirm: hideModal,
      });
      return;
    }
    if (!baleCountValid) {
      Alert.alert(
        t('confirmDelivery.alertIncompleteBalesTitle'),
        t('confirmDelivery.alertIncompleteBalesMessage'),
      );
      return;
    }
    if (!weightsValid) {
      Alert.alert(
        t('confirmDelivery.alertIncompleteWeightsTitle'),
        t('confirmDelivery.alertIncompleteWeightsMessage'),
      );
      return;
    }
    if (!signatureReady) {
      Alert.alert(
        t('confirmDelivery.alertMissingSignatureTitle'),
        t('confirmDelivery.alertMissingSignatureMessage'),
      );
      return;
    }

    setSaving(true);
    mobileLogger.flow('DepotConfirmDelivery: submitting', { tripId, baleCount, scaleBroken });

    try {
      // Upload the operator signature; fall back to base64 on failure.
      let depotOperatorSignature = signature ?? '';
      if (signature) {
        try {
          depotOperatorSignature = await uploadSignature(signature, 'receiver');
        } catch {
          mobileLogger.info('DepotConfirmDelivery: signature upload failed, using base64', {
            tripId,
          });
          // fall back to raw base64 — backend accepts both
          depotOperatorSignature = signature;
        }
      }

      const db = await getDatabase();
      const tripsRepo = new TripsRepo(db);
      const syncQueueRepo = new SyncQueueRepo(db);

      const now = new Date().toISOString();
      const idempotencyKey = generateUuid();

      // Build body — weights only for principal with working scale.
      const bodyGross =
        isPrincipal && !scaleBroken && grossWeightKg > 0 ? grossWeightKg : undefined;
      const bodyTare =
        isPrincipal && !scaleBroken && tareWeightKg >= 0 && grossWeightKg > 0
          ? tareWeightKg
          : undefined;

      const transitionBody: Record<string, unknown> = {
        baleCount,
        scaleBroken,
        depotOperatorSignature,
        idempotencyKey,
      };
      if (bodyGross !== undefined) transitionBody.grossWeightKg = bodyGross;
      if (bodyTare !== undefined) transitionBody.tareWeightKg = bodyTare;

      const queuePayload: TripTransitionPayload = {
        transition: 'confirm-depot-delivery',
        tripId,
        body: transitionBody,
      };

      // Deterministic local queue key (one confirmation per trip) so a double-tap
      // or a correct-and-resubmit SUPERSEDES the pending entry instead of appending
      // a second row — only the latest payload is pushed. The body carries the
      // server idempotency UUID (`idempotencyKey`) for server-side dedup.
      await syncQueueRepo.enqueueOrUpdate({
        entityType: 'trip_transition',
        entityId: tripId,
        action: 'update',
        payload: queuePayload,
        idempotencyKey: `confirm-depot-delivery::${tripId}`,
      });

      // Optimistic local update
      await tripsRepo.applyTransitionLocally(tripId, 'completed', {
        bale_count: baleCount,
        gross_weight_kg: bodyGross ?? null,
        tare_weight_kg: bodyTare ?? null,
        scale_broken: scaleBroken ? 1 : 0,
        delivered_at: now,
        completed_at: now,
        depot_confirmed_at: now,
        depot_operator_signature_url: depotOperatorSignature,
      });

      mobileLogger.flow('DepotConfirmDelivery: enqueued & applied locally', {
        tripId,
        baleCount,
        scaleBroken,
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Invalidate relevant queries and kick sync
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['deposit-inventory', depotId] });
      void queryClient.invalidateQueries({ queryKey: ['deposit-inventory'] });
      void triggerSync().catch(() => {});

      setSaved(true);
      setTimeout(() => router.back(), 2000);
    } catch (err) {
      mobileLogger.error('DepotConfirmDelivery: failed', {
        tripId,
        err: err instanceof Error ? { message: err.message } : err,
      });
      showModal({
        type: 'error',
        title: t('confirmDelivery.errorTitle'),
        message: err instanceof Error ? err.message : t('confirmDelivery.errorMessage'),
        onConfirm: hideModal,
      });
    } finally {
      setSaving(false);
    }
  }, [
    tripId,
    truck,
    isInsideGeofence,
    distanceM,
    baleCountValid,
    weightsValid,
    signatureReady,
    baleCount,
    scaleBroken,
    signature,
    isPrincipal,
    grossWeightKg,
    tareWeightKg,
    depotId,
    queryClient,
    triggerSync,
    showModal,
    hideModal,
  ]);

  // Success animation + screen
  if (saved) {
    Animated.spring(successScale, {
      toValue: 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
    return (
      <View style={styles.outer}>
        <ScreenHeader title={t('confirmDelivery.successScreenTitle')} />
        <View style={[styles.body, styles.centered]}>
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <MaterialCommunityIcons name="check-circle" size={72} color={colors.primary} />
          </Animated.View>
          <Text style={styles.successText}>{t('confirmDelivery.successMessage')}</Text>
          <Text style={styles.successSubtext}>
            {t('confirmDelivery.successSubtext', {
              count: baleCount,
              truck: truck?.truckCode ?? truck?.truckPlate ?? 'camion',
            })}
          </Text>
        </View>
      </View>
    );
  }

  if (showSignatureCapture) {
    return (
      <View style={styles.outer}>
        <ScreenHeader
          title={t('confirmDelivery.signatureScreenTitle')}
          onBack={() => setShowSignatureCapture(false)}
        />
        <ScrollView style={styles.body} contentContainerStyle={styles.content}>
          <Text style={styles.sigHint}>{t('confirmDelivery.signatureHint')}</Text>
          <SignatureCapture
            label={t('confirmDelivery.signatureCaptureLabel')}
            onSave={(sig) => {
              setSignature(sig);
              setShowSignatureCapture(false);
            }}
          />
          {!saving ? (
            <BigButton
              title={t('confirmDelivery.cancelSignatureButton')}
              variant="outline"
              onPress={() => setShowSignatureCapture(false)}
            />
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // Loading / truck not found state
  if (!truck && !inventoryQuery.isLoading) {
    return (
      <View style={styles.outer}>
        <ScreenHeader
          title={t('confirmDelivery.notFoundScreenTitle')}
          onBack={() => router.back()}
        />
        <View style={[styles.body, styles.centered]}>
          <MaterialCommunityIcons name="truck-alert" size={48} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>{t('confirmDelivery.notFoundTitle')}</Text>
          <Text style={styles.emptySubtitle}>{t('confirmDelivery.notFoundSubtitle')}</Text>
          <BigButton
            title={t('confirmDelivery.backButton')}
            variant="outline"
            onPress={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const truckLabel = truck ? (truck.truckCode ?? truck.truckPlate ?? truck.tripNumber) : '...';

  return (
    <View style={styles.outer}>
      <ScreenHeader title={t('confirmDelivery.mainScreenTitle')}>
        <View style={styles.headerMeta}>
          <MaterialCommunityIcons name="truck" size={14} color="rgba(255,255,255,0.85)" />
          <Text style={styles.headerMetaText}>{truckLabel}</Text>
        </View>
      </ScreenHeader>

      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        {/* Geofence gate card */}
        <View
          style={[
            styles.geofenceCard,
            isInsideGeofence ? styles.geofenceCardInside : styles.geofenceCardOutside,
          ]}
        >
          <MaterialCommunityIcons
            name={isInsideGeofence ? 'map-marker-check' : 'map-marker-alert'}
            size={20}
            color={isInsideGeofence ? colors.primary : '#991B1B'}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.geofenceLabel, !isInsideGeofence && styles.geofenceLabelOutside]}>
              {isInsideGeofence
                ? t('confirmDelivery.geofenceInsideLabel')
                : distanceM != null
                  ? t('confirmDelivery.geofenceDistanceLabel', { distance: distanceM })
                  : t('confirmDelivery.geofenceUnknownPosition')}
            </Text>
            {isInsideGeofence ? (
              <Text style={styles.geofenceInside}>{t('confirmDelivery.geofenceInPerimeter')}</Text>
            ) : (
              <Text style={styles.geofenceOutside}>
                {distanceM != null
                  ? t('confirmDelivery.geofenceWaiting')
                  : t('confirmDelivery.geofenceNoRecentLocation')}
              </Text>
            )}
          </View>
        </View>

        {/* Truck + driver info */}
        {truck ? (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="truck" size={16} color={colors.primary} />
              <Text style={styles.infoText}>
                {truck.truckCode ?? truck.truckPlate ?? '—'}
                {truck.truckPlate && truck.truckCode ? ` · ${truck.truckPlate}` : ''}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="account" size={16} color={colors.primary} />
              <Text style={styles.infoText}>{truck.driverName ?? '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="grain" size={16} color={colors.primary} />
              <Text style={styles.infoText}>
                {t('confirmDelivery.truckBalesLoaded', { count: truck.baleCount })}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Bale count input */}
        <Text style={styles.fieldLabel}>{t('confirmDelivery.fieldLabelBaleCount')}</Text>
        <NumericPad value={baleCountStr} onChange={setBaleCountStr} decimal={false} />

        {/* Weight inputs — principal depot only */}
        {isPrincipal ? (
          <View style={styles.weightSection}>
            <View style={styles.scaleBrokenRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.scaleBrokenLabel}>{t('confirmDelivery.scaleBrokenLabel')}</Text>
                <Text style={styles.scaleBrokenSub}>
                  {t('confirmDelivery.scaleBrokenSubtitle')}
                </Text>
              </View>
              <Switch
                value={scaleBroken}
                onValueChange={setScaleBroken}
                trackColor={{ true: '#C62828', false: '#E5E7EB' }}
                thumbColor={scaleBroken ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

            {!scaleBroken ? (
              <>
                <Text style={styles.fieldLabel}>{t('confirmDelivery.fieldLabelWeights')}</Text>
                <View style={styles.weightsRow}>
                  <TouchableOpacity
                    style={[
                      styles.weightField,
                      activeWeightField === 'gross' && styles.weightFieldActive,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => setActiveWeightField('gross')}
                  >
                    <Text style={styles.weightFieldLabel}>
                      {t('confirmDelivery.weightFieldGross')}
                    </Text>
                    <Text style={styles.weightFieldValue}>{grossWeightStr || '0'} kg</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.weightField,
                      activeWeightField === 'tare' && styles.weightFieldActive,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => setActiveWeightField('tare')}
                  >
                    <Text style={styles.weightFieldLabel}>
                      {t('confirmDelivery.weightFieldTare')}
                    </Text>
                    <Text style={styles.weightFieldValue}>{tareWeightStr || '0'} kg</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.netRow}>
                  <Text style={styles.netLabel}>{t('confirmDelivery.netLabel')}</Text>
                  <Text style={[styles.netValue, netWeightKg <= 0 && styles.netValueInvalid]}>
                    {netWeightKg > 0 ? `${netWeightKg} kg` : '—'}
                  </Text>
                </View>
                {tareWeightKg > grossWeightKg && tareWeightStr.length > 0 ? (
                  <Text style={styles.errorText}>{t('confirmDelivery.tareExceedsGrossError')}</Text>
                ) : null}
                <Text style={styles.editingHint}>
                  {t('confirmDelivery.editingHint', {
                    field:
                      activeWeightField === 'gross'
                        ? t('confirmDelivery.editingFieldGross')
                        : t('confirmDelivery.editingFieldTare'),
                  })}
                </Text>
                <NumericPad
                  value={activeWeightField === 'gross' ? grossWeightStr : tareWeightStr}
                  onChange={activeWeightField === 'gross' ? setGrossWeightStr : setTareWeightStr}
                  decimal
                  maxLength={8}
                />
              </>
            ) : (
              <View style={styles.scaleBrokenNotice}>
                <MaterialCommunityIcons name="scale-off" size={20} color="#C62828" />
                <Text style={styles.scaleBrokenNoticeText}>
                  {t('confirmDelivery.scaleBrokenNotice')}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Signature section */}
        <View style={styles.signatureSection}>
          <Text style={styles.fieldLabel}>{t('confirmDelivery.fieldLabelSignature')}</Text>
          {signature ? (
            <View style={styles.signedRow}>
              <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
              <Text style={styles.signedText}>{t('confirmDelivery.signatureCaptured')}</Text>
              <TouchableOpacity onPress={() => setShowSignatureCapture(true)}>
                <Text style={styles.resignLink}>{t('confirmDelivery.resignLink')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <BigButton
              title={t('confirmDelivery.addSignatureButton')}
              variant="outline"
              onPress={() => setShowSignatureCapture(true)}
            />
          )}
        </View>

        {/* Geofence gate hint */}
        {!isInsideGeofence ? (
          <Text style={styles.gateHint}>
            {distanceM != null
              ? t('confirmDelivery.gateHintWithDistance', { distance: distanceM })
              : t('confirmDelivery.gateHintNoPosition')}
          </Text>
        ) : null}

        {/* Submit */}
        <BigButton
          title={
            saving ? t('confirmDelivery.submitButtonSaving') : t('confirmDelivery.submitButton')
          }
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
        />
        <BigButton
          title={t('confirmDelivery.cancelButton')}
          variant="outline"
          onPress={() => router.back()}
        />
      </ScrollView>

      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#0A5C36' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerMetaText: { fontSize: 13, color: 'rgba(255, 255, 255, 0.85)' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 60 },
  content: { padding: 16, gap: 12 },

  // Geofence gate
  geofenceCard: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 4,
    backgroundColor: '#FFFFFF',
  },
  geofenceCardInside: { borderLeftColor: colors.primary },
  geofenceCardOutside: { borderLeftColor: '#991B1B' },
  geofenceLabel: { fontSize: 14, fontWeight: '700', color: colors.primary },
  geofenceLabelOutside: { color: '#991B1B' },
  geofenceInside: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 2 },
  geofenceOutside: { fontSize: 12, color: '#991B1B', marginTop: 2 },

  // Truck info
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 13, color: '#5D4037', flex: 1 },

  // Bale count
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#5D4037', marginTop: 4 },

  // Weight inputs
  weightSection: { gap: 10 },
  scaleBrokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
  },
  scaleBrokenLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  scaleBrokenSub: { fontSize: 12, color: '#8D6E63', marginTop: 2 },
  scaleBrokenNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  scaleBrokenNoticeText: { fontSize: 13, color: '#C62828', flex: 1 },
  weightsRow: { flexDirection: 'row', gap: 10 },
  weightField: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    gap: 4,
  },
  weightFieldActive: { borderColor: colors.primary, backgroundColor: '#F9FFF9' },
  weightFieldLabel: { fontSize: 12, fontWeight: '600', color: '#8D6E63', textAlign: 'center' },
  weightFieldValue: { fontSize: 20, fontWeight: '800', color: colors.primary },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  netLabel: { fontSize: 15, fontWeight: '600', color: '#8D6E63' },
  netValue: { fontSize: 20, fontWeight: '800', color: '#0A5C36' },
  netValueInvalid: { color: '#9CA3AF' },
  errorText: { fontSize: 13, color: '#C62828', textAlign: 'center' },
  editingHint: { fontSize: 12, color: '#8D6E63', textAlign: 'center', marginTop: 4 },

  // Signature
  signatureSection: { gap: 8 },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signedText: { fontSize: 14, fontWeight: '600', color: colors.primary, flex: 1 },
  resignLink: { fontSize: 13, color: '#5D4037', textDecorationLine: 'underline' },
  sigHint: { fontSize: 14, color: '#5D4037', paddingHorizontal: 4, paddingBottom: 8 },

  // Gate hint
  gateHint: { fontSize: 12, color: '#991B1B', textAlign: 'center', marginTop: -4 },

  // Success
  successText: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  successSubtext: { fontSize: 14, color: '#5D4037', textAlign: 'center', paddingHorizontal: 24 },

  // Empty state
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptySubtitle: { fontSize: 13, color: '#8D6E63', textAlign: 'center', paddingHorizontal: 24 },
});
