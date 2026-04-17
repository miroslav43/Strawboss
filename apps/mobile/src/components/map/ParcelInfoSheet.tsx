import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import { openExternalNavigation } from '@/lib/routing';

interface ParcelInfo {
  id: string;
  name: string | null;
  code: string;
  areaHectares?: number;
  municipality?: string;
  harvestStatus?: string;
  centroidLat?: number;
  centroidLon?: number;
}

export interface ParcelSheetRouteInfo {
  distanceKm: number;
  durationMin: number;
}

interface ParcelInfoSheetProps {
  parcel: ParcelInfo;
  /** Set after "Previzualizează ruta" succeeds; sheet stays open for Google Maps + close. */
  routeInfo: ParcelSheetRouteInfo | null;
  hasUserLocation: boolean;
  onPreviewRoute: () => void;
  onDismiss: () => void;
  isLoadingRoute?: boolean;
}

type SheetMode = 'full' | 'peek';

const PEEK_HEIGHT = 140;
/**
 * Distance (px) the user must drag before we commit a snap even without velocity.
 * If they release before reaching this, the sheet returns to its prior mode.
 */
const SNAP_DISTANCE = 60;
/** dy threshold below which a PanResponder interaction is treated as a tap. */
const TAP_SLOP = 5;
/** Max ms between touch start and release for a gesture to count as a tap. */
const TAP_MAX_MS = 200;
const SPRING_CONFIG = { friction: 10, tension: 80, useNativeDriver: true };

const HARVEST_LABELS: Record<string, string> = {
  planned: 'Planificat',
  to_harvest: 'De recoltat',
  harvesting: 'Se recoltează',
  harvested: 'Recoltat',
};

export function ParcelInfoSheet({
  parcel,
  routeInfo,
  hasUserLocation,
  onPreviewRoute,
  onDismiss,
  isLoadingRoute,
}: ParcelInfoSheetProps) {
  const hasCoords = parcel.centroidLat != null && parcel.centroidLon != null;

  // The sheet's full content height, measured once via onLayout. Until measured
  // we keep translateY at 0 so the sheet is fully visible.
  const [sheetHeight, setSheetHeight] = useState(0);
  const [mode, setMode] = useState<SheetMode>('full');

  const translateY = useRef(new Animated.Value(0)).current;
  const modeRef = useRef<SheetMode>('full');
  const touchStartRef = useRef<{ t: number; y: number } | null>(null);
  const prevRouteInfoRef = useRef<ParcelSheetRouteInfo | null>(null);

  const peekOffset = Math.max(0, sheetHeight - PEEK_HEIGHT);

  const snapTo = useCallback(
    (next: SheetMode) => {
      modeRef.current = next;
      setMode(next);
      Animated.spring(translateY, {
        toValue: next === 'peek' ? peekOffset : 0,
        ...SPRING_CONFIG,
      }).start();
    },
    [translateY, peekOffset],
  );

  // Reset to full whenever a new parcel is selected.
  useEffect(() => {
    snapTo('full');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel.id]);

  // Auto-snap to peek the first time a route appears, so the user immediately
  // sees the drawn route on the map with only the summary + CTA on screen.
  useEffect(() => {
    const prev = prevRouteInfoRef.current;
    if (prev == null && routeInfo != null) {
      snapTo('peek');
    }
    prevRouteInfoRef.current = routeInfo;
  }, [routeInfo, snapTo]);

  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      // Only capture the first meaningful measurement; later re-layouts (e.g.
      // a pill showing/hiding) would otherwise jump the sheet mid-gesture.
      if (h > 0 && sheetHeight === 0) {
        setSheetHeight(h);
      }
    },
    [sheetHeight],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 2,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        touchStartRef.current = {
          t: Date.now(),
          y: evt.nativeEvent.pageY,
        };
        translateY.stopAnimation();
      },
      onPanResponderMove: (_evt, gesture: PanResponderGestureState) => {
        const base = modeRef.current === 'peek' ? peekOffset : 0;
        const next = Math.min(peekOffset, Math.max(0, base + gesture.dy));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture: PanResponderGestureState) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;

        const isTap =
          start != null &&
          Date.now() - start.t < TAP_MAX_MS &&
          Math.abs(gesture.dx) < TAP_SLOP &&
          Math.abs(gesture.dy) < TAP_SLOP;

        if (isTap) {
          snapTo(modeRef.current === 'peek' ? 'full' : 'peek');
          return;
        }

        // Velocity-aware snap: a flick beats the raw distance threshold.
        if (gesture.vy > 0.5) {
          snapTo('peek');
          return;
        }
        if (gesture.vy < -0.5) {
          snapTo('full');
          return;
        }

        const base = modeRef.current === 'peek' ? peekOffset : 0;
        const travelled = gesture.dy; // positive = downward
        if (modeRef.current === 'full' && travelled > SNAP_DISTANCE) {
          snapTo('peek');
        } else if (modeRef.current === 'peek' && -travelled > SNAP_DISTANCE) {
          snapTo('full');
        } else {
          // Rubber-band back to current mode.
          Animated.spring(translateY, {
            toValue: base,
            ...SPRING_CONFIG,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        const base = modeRef.current === 'peek' ? peekOffset : 0;
        Animated.spring(translateY, {
          toValue: base,
          ...SPRING_CONFIG,
        }).start();
      },
    }),
  ).current;

  const handleStartGoogleMaps = async () => {
    if (!hasCoords) return;
    try {
      await openExternalNavigation(parcel.centroidLat!, parcel.centroidLon!);
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut deschide Google Maps sau navigația.');
    }
  };

  const routeSummary =
    routeInfo == null
      ? null
      : routeInfo.durationMin > 0
        ? `${routeInfo.distanceKm.toFixed(1)} km · ${Math.round(routeInfo.durationMin)} min`
        : `${routeInfo.distanceKm.toFixed(1)} km (linie directă)`;

  const isPeek = mode === 'peek';

  return (
    <View
      style={styles.backdrop}
      // Peek: let the map under the sheet receive taps. Full: the whole overlay
      // absorbs them so the outside-tap dismisses.
      pointerEvents={isPeek ? 'box-none' : 'auto'}
    >
      {/* Dismiss-on-backdrop only in full mode. */}
      {!isPeek ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      ) : null}

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        onLayout={onSheetLayout}
      >
        {/* Drag handle: larger hit area + PanResponder for tap/drag. */}
        <View style={styles.handleHitArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.name}>{parcel.name || parcel.code}</Text>
        {parcel.name && parcel.code ? (
          <Text style={styles.code}>{parcel.code}</Text>
        ) : null}

        {routeSummary != null ? (
          <View style={styles.routeSummaryBox}>
            <Text style={styles.routeSummaryLabel}>Traseu pe hartă</Text>
            <Text style={styles.routeSummaryValue}>{routeSummary}</Text>
          </View>
        ) : null}

        {/* Peek: single primary CTA. Full: complete details + both CTAs. */}
        {isPeek ? (
          <View style={styles.buttons}>
            {routeInfo != null ? (
              <TouchableOpacity
                style={styles.navButton}
                onPress={handleStartGoogleMaps}
                disabled={!hasCoords}
              >
                <Text style={styles.navButtonText}>Start în Google Maps</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.navButton,
                  (!hasCoords || !hasUserLocation) && styles.btnDisabled,
                ]}
                onPress={onPreviewRoute}
                disabled={!hasCoords || !hasUserLocation || isLoadingRoute}
              >
                {isLoadingRoute ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.navButtonText}>Previzualizează ruta</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {!hasCoords ? (
              <Text style={styles.helperWarning}>
                Coordonatele destinației nu sunt disponibile pentru această selecție. Nu se poate
                previzualiza ruta sau deschide navigația.
              </Text>
            ) : null}

            <View style={styles.infoRow}>
              {parcel.areaHectares != null && (
                <View style={styles.infoPill}>
                  <Text style={styles.infoLabel}>Suprafață</Text>
                  <Text style={styles.infoValue}>{parcel.areaHectares} ha</Text>
                </View>
              )}
              {parcel.harvestStatus && (
                <View style={styles.infoPill}>
                  <Text style={styles.infoLabel}>Status</Text>
                  <Text style={styles.infoValue}>
                    {HARVEST_LABELS[parcel.harvestStatus] ?? parcel.harvestStatus}
                  </Text>
                </View>
              )}
              {parcel.municipality && (
                <View style={styles.infoPill}>
                  <Text style={styles.infoLabel}>Localitate</Text>
                  <Text style={styles.infoValue}>{parcel.municipality}</Text>
                </View>
              )}
            </View>

            <View style={styles.buttons}>
              {routeInfo != null ? (
                <>
                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={handleStartGoogleMaps}
                    disabled={!hasCoords}
                  >
                    <Text style={styles.navButtonText}>Start în Google Maps</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.extButton} onPress={onDismiss}>
                    <Text style={styles.extButtonText}>Închide</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.navButton,
                      (!hasCoords || !hasUserLocation) && styles.btnDisabled,
                    ]}
                    onPress={onPreviewRoute}
                    disabled={!hasCoords || !hasUserLocation || isLoadingRoute}
                  >
                    {isLoadingRoute ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.navButtonText}>Previzualizează ruta</Text>
                    )}
                  </TouchableOpacity>
                  {!hasUserLocation && hasCoords ? (
                    <Text style={styles.helperMuted}>
                      Activează locația pentru a calcula traseul pe hartă.
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.extButton, !hasCoords && styles.btnDisabledOutline]}
                    onPress={handleStartGoogleMaps}
                    disabled={!hasCoords}
                  >
                    <Text style={styles.extButtonText}>Start în Google Maps</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  handleHitArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: -12,
    marginBottom: -4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
  },
  name: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  code: { fontSize: 13, color: '#8D6E63', marginTop: -6 },
  helperWarning: {
    fontSize: 14,
    color: '#B71C1C',
    lineHeight: 20,
  },
  helperMuted: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  routeSummaryBox: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  routeSummaryLabel: { fontSize: 12, color: '#2E7D32', fontWeight: '600' },
  routeSummaryValue: { fontSize: 16, color: '#1B5E20', fontWeight: '700' },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoPill: {
    backgroundColor: '#F3DED8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  infoLabel: { fontSize: 11, color: '#8D6E63', fontWeight: '500' },
  infoValue: { fontSize: 14, color: '#374151', fontWeight: '600' },
  buttons: { gap: 8, marginTop: 4 },
  navButton: {
    backgroundColor: '#0A5C36',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.45 },
  extButton: {
    borderWidth: 2,
    borderColor: '#0A5C36',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  extButtonText: { color: '#0A5C36', fontSize: 15, fontWeight: '600' },
  btnDisabledOutline: { opacity: 0.45 },
});
