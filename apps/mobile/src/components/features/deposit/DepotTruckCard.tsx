import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii } from '@strawboss/ui-tokens';
import type { DepotIncomingTruck } from '@/hooks/useDepotInventory';

/**
 * One inbound truck as the depot operator sees it — the actionable unit of the
 * manned-depot flow.
 *
 * Shared by the Inventar home tab and the Curse list. Both used to inline their
 * own markup: the home tab's version had no distance, no perimeter badge and no
 * button, so the screen the operator actually lands on could not be acted upon.
 *
 * The button is NEVER silently inert. Its previous form rendered grey and
 * swallowed the tap when the truck sat outside the geofence, which reads as a
 * broken app — the operator can see the lorry through the window. It now always
 * states why it is blocked and, where the evidence permits, offers the override.
 */

/** What the operator can do with this truck right now. */
export type DepotTruckAction = 'start' | 'finish';

interface Props {
  truck: DepotIncomingTruck;
  /** `true` once the operator pressed "Începe descărcarea" on this trip. */
  onPress: (truck: DepotTruckCardTruck, action: DepotTruckAction) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  primaryColor: string;
  /** Dim the card (e.g. still far away) without disabling it. */
  dimmed?: boolean;
}

export type DepotTruckCardTruck = DepotIncomingTruck;

const STATUS_COLORS: Record<string, string> = {
  in_transit: '#8D6E63',
  arrived: '#2E7D32',
  delivering: '#B7791F',
};

/** Metres below 1 km read as metres; above, as km — mirrors the loader board. */
function formatDistance(distanceM: number | null, t: Props['t']): string {
  if (distanceM == null) return t('depositTrips.distanceUnknown');
  if (distanceM >= 1000) {
    return t('depositTrips.distanceFromDepotKm', { distance: (distanceM / 1000).toFixed(1) });
  }
  return t('depositTrips.distanceFromDepot', { distance: Math.round(distanceM) });
}

export function DepotTruckCard({ truck, onPress, t, primaryColor, dimmed }: Props) {
  const unloading = truck.unloadStartedAt != null;
  const action: DepotTruckAction = unloading ? 'finish' : 'start';

  /*
   * An unlinked trip (destination_id IS NULL) reached this list by proximity
   * alone, so its GPS match is the ONLY evidence it was ever headed here. The
   * server refuses to adopt it on an override for exactly that reason — so do
   * not offer one, or the operator taps a button that can only fail.
   */
  const canOverride = !truck.destinationLinked ? false : true;
  const blocked = !truck.isInsideGeofence;

  const statusLabel =
    truck.status === 'in_transit'
      ? t('depositTrips.statusInTransit')
      : truck.status === 'arrived'
        ? t('depositTrips.statusArrived')
        : t('depositTrips.statusDelivering');

  const buttonLabel = unloading
    ? t('depositTrips.finishUnloadButton')
    : t('depositTrips.startUnloadButton');

  return (
    <View style={[styles.card, dimmed && styles.dimmed]}>
      <View style={styles.header}>
        <Text style={styles.tripNumber} numberOfLines={1}>
          {truck.tripNumber}
          {truck.iterationIndex && truck.iterationIndex > 1
            ? ` · ${t('depositTrips.tripIteration', { index: truck.iterationIndex })}`
            : ''}
        </Text>
        <View style={styles.headerRight}>
          {truck.isInsideGeofence ? (
            <View style={styles.geofenceBadge}>
              <MaterialCommunityIcons name="map-marker-check" size={12} color="#FFFFFF" />
              <Text style={styles.geofenceBadgeText}>{t('depositTrips.geofenceBadge')}</Text>
            </View>
          ) : null}
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: unloading ? '#B7791F' : (STATUS_COLORS[truck.status] ?? '#5D4037'),
              },
            ]}
          >
            <Text style={styles.statusText}>
              {unloading ? t('depositTrips.statusUnloading') : statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.row}>
        <MaterialCommunityIcons name="truck" size={16} color={primaryColor} />
        <Text style={styles.rowText} numberOfLines={1}>
          {truck.truckCode ?? truck.truckPlate ?? '—'}
        </Text>
      </View>
      <View style={styles.row}>
        <MaterialCommunityIcons name="account" size={16} color={primaryColor} />
        <Text style={styles.rowText} numberOfLines={1}>
          {truck.driverName ?? '—'}
        </Text>
      </View>
      <View style={styles.row}>
        <MaterialCommunityIcons name="grain" size={16} color={primaryColor} />
        <Text style={styles.rowText}>
          {t('depositTrips.tripBaleCount', { count: truck.baleCount })}
        </Text>
      </View>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name="map-marker-distance"
          size={16}
          color={truck.isInsideGeofence ? primaryColor : '#8D6E63'}
        />
        <Text style={[styles.rowText, truck.isInsideGeofence && styles.rowTextInside]}>
          {truck.isInsideGeofence
            ? t('depositTrips.distanceInsideGeofence')
            : formatDistance(truck.distanceM, t)}
        </Text>
      </View>

      {/*
       * The reason line only ever appears when the operator is blocked, and it
       * always names the actual obstacle. "Nothing happens when I tap" was the
       * single most common way this feature failed in the field.
       */}
      {blocked ? (
        <Text style={styles.blockedHint}>
          {truck.distanceM == null
            ? t('depositTrips.blockedNoGps')
            : t('depositTrips.blockedOutside', { distance: Math.round(truck.distanceM) })}
          {!truck.destinationLinked ? ` ${t('depositTrips.blockedUnlinked')}` : ''}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.button, blocked && styles.buttonBlocked]}
        activeOpacity={0.8}
        onPress={() => onPress(truck, action)}
      >
        <MaterialCommunityIcons
          name={unloading ? 'clipboard-check' : 'forklift'}
          size={16}
          color={blocked ? '#92400E' : '#FFFFFF'}
        />
        <Text style={[styles.buttonText, blocked && styles.buttonTextBlocked]}>
          {blocked && canOverride ? t('depositTrips.confirmAnywayButton') : buttonLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF', borderRadius: radii.md, padding: 14, gap: 6 },
  dimmed: { opacity: 0.7 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  tripNumber: { flex: 1, fontSize: 15, fontWeight: '600', color: '#374151' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { flexShrink: 0, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  geofenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0A5C36',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  geofenceBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, fontSize: 13, color: '#5D4037' },
  rowTextInside: { color: '#0A5C36', fontWeight: '600' },
  blockedHint: {
    fontSize: 12,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0A5C36',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 4,
  },
  buttonBlocked: { backgroundColor: '#FDE68A' },
  buttonText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  buttonTextBlocked: { color: '#92400E' },
  emptyHint: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
});
