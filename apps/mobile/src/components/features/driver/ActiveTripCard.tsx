import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TripProgress } from '@/components/shared/TripProgress';
import { BigButton } from '@/components/ui/BigButton';
import type { LocalTrip } from '@/db/trips-repo';
import { useDestinationProximity } from '@/hooks/useDestinationProximity';
import { colors, radii } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

const STATUS_COLORS: Record<string, string> = {
  planned: '#1565C0',
  loading: '#B7791F',
  loaded: '#0A5C36',
  in_transit: '#8D6E63',
  arrived: '#2E7D32',
  delivering: '#B7791F',
  delivered: '#2E7D32',
  completed: '#5D4037',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  planned: 'driver.activeTripCard.status.planned',
  loading: 'driver.activeTripCard.status.loading',
  loaded: 'driver.activeTripCard.status.loaded',
  in_transit: 'driver.activeTripCard.status.inTransit',
  arrived: 'driver.activeTripCard.status.arrived',
  delivering: 'driver.activeTripCard.status.delivering',
  delivered: 'driver.activeTripCard.status.delivered',
  completed: 'driver.activeTripCard.status.completed',
};

// FM-12 — trips in these statuses are "active". Ranked so the most advanced /
// actionable one is featured first. `planned` is included so the driver sees an
// assigned trip even before the loader has loaded it.
const ACTIVE_STATUSES = new Set([
  'planned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivering',
  'delivered',
]);

const STATUS_RANK: Record<string, number> = {
  delivered: 6,
  delivering: 5,
  arrived: 4,
  in_transit: 3,
  loaded: 2,
  loading: 1,
  planned: 0,
};

/**
 * From a list of trips, pick the most relevant active trip to feature:
 * highest status rank wins; ties broken by most-recently-updated.
 */
export function pickFeaturedTrip(trips: LocalTrip[]): LocalTrip | null {
  const active = trips.filter((t) => ACTIVE_STATUSES.has(t.status));
  if (active.length === 0) return null;
  return active.reduce((best, t) => {
    const rankDiff = (STATUS_RANK[t.status] ?? 0) - (STATUS_RANK[best.status] ?? 0);
    if (rankDiff > 0) return t;
    if (rankDiff < 0) return best;
    return t.updated_at > best.updated_at ? t : best;
  });
}

const ACTION_LABEL_KEYS: Record<string, string> = {
  loaded: 'driver.activeTripCard.action.depart',
  in_transit: 'driver.activeTripCard.action.markArrival',
  arrived: 'driver.activeTripCard.action.startDelivery',
  delivering: 'driver.activeTripCard.action.confirmDelivery',
  delivered: 'driver.activeTripCard.action.finalize',
};

/** Key for the next actionable button on the active-trip card. */
export function getActionLabelKey(status: string): string | null {
  return ACTION_LABEL_KEYS[status] ?? null;
}

/** Auto km/m formatting for the distance-to-depot readout. */
function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

interface ActiveTripCardProps {
  trip: LocalTrip;
  onPress: (trip: LocalTrip) => void;
}

/**
 * FM-12 — the featured "Cursă activă" card for the driver. Lives on the Livrare
 * tab and shows, next to the destination depot, a live distance-to-geofence
 * readout (metres / km, or "În geofence" when the driver is inside).
 */
export function ActiveTripCard({ trip, onPress }: ActiveTripCardProps) {
  const { t } = useI18n();
  const actionLabelKey = getActionLabelKey(trip.status);
  const actionLabel = actionLabelKey ? t(actionLabelKey) : null;
  const statusColor = STATUS_COLORS[trip.status] ?? '#5D4037';
  const statusLabelKey = STATUS_LABEL_KEYS[trip.status];
  const statusLabel = statusLabelKey ? t(statusLabelKey) : trip.status;
  const proximity = useDestinationProximity(trip.destination_id);

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="truck-fast" size={16} color={colors.primary} />
          <Text style={styles.sectionLabel}>{t('driver.activeTripCard.sectionLabel')}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusBadgeText}>{statusLabel}</Text>
        </View>
      </View>

      {/* Trip number + destination + live proximity */}
      <View style={styles.tripInfoRow}>
        <Text style={styles.tripNumber}>
          {trip.trip_number ?? t('driver.activeTripCard.tripFallbackLabel')}
        </Text>
        {trip.destination_name ? (
          <View style={styles.destinationRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color="#5D4037" />
            <Text style={styles.destination} numberOfLines={1}>
              {trip.destination_name}
            </Text>
            {proximity.status === 'inside' ? (
              <View style={[styles.proxPill, styles.proxInside]}>
                <MaterialCommunityIcons name="map-marker-check" size={12} color="#0A5C36" />
                <Text style={styles.proxInsideText}>
                  {t('driver.activeTripCard.insideGeofence')}
                </Text>
              </View>
            ) : proximity.distanceM != null && Number.isFinite(proximity.distanceM) ? (
              <View style={styles.proxPill}>
                <MaterialCommunityIcons name="map-marker-distance" size={12} color="#5D4037" />
                <Text style={styles.proxText}>{formatDistance(proximity.distanceM)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {trip.destination_address ? (
          <Text style={styles.destinationAddr} numberOfLines={1}>
            {trip.destination_address}
          </Text>
        ) : null}
      </View>

      {/* Bale count */}
      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="grain" size={13} color="#8D6E63" />
        <Text style={styles.metaText}>
          {t('driver.activeTripCard.baleCount').replace('{count}', String(trip.bale_count))}
        </Text>
      </View>

      {/* Trip progress bar */}
      <TripProgress currentStatus={trip.status} />

      {/* Action button — only when there is a clear next step */}
      {actionLabel ? (
        <BigButton title={actionLabel} onPress={() => onPress(trip)} variant="primary" />
      ) : (
        <TouchableOpacity
          style={styles.viewButton}
          onPress={() => onPress(trip)}
          activeOpacity={0.8}
        >
          <Text style={styles.viewButtonText}>{t('driver.activeTripCard.viewDetails')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.lg,
    padding: 16,
    gap: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.13,
    shadowRadius: 6,
    elevation: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  tripInfoRow: { gap: 4 },
  tripNumber: { fontSize: 18, fontWeight: '700', color: '#111' },
  destinationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  destination: { fontSize: 13, color: '#5D4037', flex: 1 },
  destinationAddr: { fontSize: 12, color: '#8D6E63', marginLeft: 18 },
  proxPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proxText: { fontSize: 12, fontWeight: '600', color: '#5D4037' },
  proxInside: { backgroundColor: '#E8F5EE' },
  proxInsideText: { fontSize: 12, fontWeight: '700', color: '#0A5C36' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textSecondary },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  viewButtonText: { fontSize: 14, fontWeight: '600', color: colors.primary },
});
