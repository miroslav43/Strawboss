/**
 * Shared parcel detail view — used by both the baler and the loader role.
 *
 * Renders a read-only summary of a parcel: code (large), bales currently on the
 * field, area, crop type, harvest status, location and notes — plus quick
 * actions. The hosting route supplies role-specific behaviour through props:
 *   - `primaryAction` — e.g. the baler's "Înregistrează producție" CTA. Loaders
 *     omit it (they don't produce bales).
 *   - `onOpenMap` — pushes the role's own map tab focused on this parcel.
 * The "Navighează până acolo" button is common to both roles.
 *
 * Data strategy: the local SQLite parcels cache is consulted first (works
 * offline), then the latest API row is layered on top. The bale count comes
 * from the online-only `/bale-availability` endpoint; when offline it degrades
 * to a dash rather than blocking the screen.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Alert,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { BigButton } from '@/components/ui/BigButton';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { ParcelsRepo, type LocalParcel } from '@/db/parcels-repo';
import { useTheme } from '@/lib/theme';
import { mobileLogger } from '@/lib/logger';
import { openExternalNavigation, parseGeoPoint } from '@/lib/routing';

const CROP_LABELS: Record<string, string> = {
  grau: 'Grâu',
  orz: 'Orz',
  rapita: 'Rapiță',
  plante_nutret: 'Plante de nutreț',
};

const HARVEST_LABELS: Record<string, string> = {
  planned: 'Planificat',
  to_harvest: 'De recoltat',
  harvesting: 'În recoltă',
  partial_harvested: 'Parțial recoltat',
  harvested: 'Recoltat',
  in_loading: 'În încărcare',
  loaded: 'Încărcat',
  completed: 'Finalizat',
};

const HARVEST_COLORS: Record<string, string> = {
  planned: '#94A3B8',
  to_harvest: '#D97706',
  harvesting: '#B45309',
  partial_harvested: '#EA580C',
  harvested: '#CA8A04',
  in_loading: '#0284C7',
  loaded: '#2563EB',
  completed: '#059669',
};

interface ApiParcel {
  id: string;
  code: string;
  name: string | null;
  areaHectares: number | string | null;
  municipality: string | null;
  address: string | null;
  notes: string | null;
  harvestStatus: string | null;
  cropType: string | null;
  /** GeoJSON Point `{ coordinates: [lon, lat] }` from ST_AsGeoJSON — used for nav. */
  centroid?: unknown;
}

interface BaleAvailability {
  produced: number | string;
  loaded: number | string;
  remaining: number | string;
}

export interface ParcelDetailViewProps {
  parcelId: string;
  /** Push the hosting role's map tab focused on this parcel. */
  onOpenMap: () => void;
  /** Optional role-specific primary CTA (baler: record production). */
  primaryAction?: { label: string; onPress: () => void };
}

function formatHa(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2).replace('.', ',')} ha`;
}

export function ParcelDetailView({ parcelId, onOpenMap, primaryAction }: ParcelDetailViewProps) {
  const { colors: themeColors } = useTheme();
  const [localParcel, setLocalParcel] = useState<LocalParcel | null>(null);
  const [localLoading, setLocalLoading] = useState(true);

  // Local SQLite cache lookup (works offline; usually instant)
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new ParcelsRepo(db);
        const found = await repo.findById(parcelId ?? '');
        if (mounted) setLocalParcel(found);
      } catch (err) {
        mobileLogger.flow('parcel-detail: local lookup failed', {
          parcelId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (mounted) setLocalLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [parcelId]);

  // Fresh API fetch — overrides the local cache when available
  const apiQuery = useQuery({
    queryKey: ['parcel', parcelId],
    queryFn: () => mobileApiClient.get<ApiParcel>(`/api/v1/parcels/${parcelId}`),
    enabled: !!parcelId,
    staleTime: 60_000,
  });

  // Bales currently on the field (produced − loaded). Online-only; degrades to
  // a dash when offline so it never blocks the rest of the screen. These are
  // live counts, so never serve them stale — always refetch when the field is
  // opened (staleTime 0 + refetchOnMount 'always'); the previous 30 s window
  // could pin a cached 0 while production/loading data had already landed.
  const baleQuery = useQuery({
    queryKey: ['parcel-bale-availability', parcelId],
    queryFn: () =>
      mobileApiClient.get<BaleAvailability>(`/api/v1/parcels/${parcelId}/bale-availability`),
    enabled: !!parcelId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Pull-to-refresh: re-pull the parcel row + live bale counts on demand.
  const [refreshing, setRefreshing] = useState(false);
  const refetchApi = apiQuery.refetch;
  const refetchBale = baleQuery.refetch;
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchApi(), refetchBale()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchApi, refetchBale]);

  const merged =
    apiQuery.data ??
    (localParcel
      ? ({
          id: localParcel.id,
          code: localParcel.code,
          name: localParcel.name,
          areaHectares: localParcel.area_hectares,
          municipality: localParcel.municipality,
          address: null,
          notes: null,
          harvestStatus: localParcel.harvest_status,
          cropType: localParcel.crop_type,
        } as ApiParcel)
      : null);

  // Field coordinates for external navigation. The live API row carries the
  // centroid (ST_AsGeoJSON), so the button works whenever online — regardless
  // of whether the map tab ever warmed the local cache. Fall back to the
  // offline parcel cache so it still works with no signal.
  const navCoords = useMemo(() => {
    const apiCoords = parseGeoPoint(apiQuery.data?.centroid ?? null);
    if (apiCoords) return apiCoords;
    if (!localParcel?.centroid_json) return null;
    try {
      return parseGeoPoint(JSON.parse(localParcel.centroid_json));
    } catch {
      return null;
    }
  }, [apiQuery.data, localParcel]);

  const handleNavigate = useCallback(async () => {
    if (!navCoords) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // Haptics module missing on some platforms — ignore.
    }
    mobileLogger.info('parcel detail navigate pressed', {
      feature: 'parcel.navigate',
      parcelId,
      lat: navCoords.lat,
      lon: navCoords.lon,
    });
    try {
      await openExternalNavigation(navCoords.lat, navCoords.lon);
    } catch (err) {
      mobileLogger.flow('parcel-detail: navigation failed to open', {
        parcelId,
        err: err instanceof Error ? err.message : String(err),
      });
      Alert.alert('Navigație', 'Nu s-a putut deschide aplicația de navigație.');
    }
  }, [navCoords, parcelId]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  // Loading splash while both local and remote are pending
  if (localLoading && apiQuery.isLoading) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Parcelă" onBack={handleBack} />
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      </View>
    );
  }

  // No data at all (offline + cache miss)
  if (!merged) {
    return (
      <View style={styles.outerContainer}>
        <ScreenHeader title="Parcelă" onBack={handleBack} />
        <View style={[styles.body, styles.centered]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#5D4037" />
          <Text style={styles.missingTitle}>Câmpul nu a putut fi încărcat</Text>
          <Text style={styles.missingSubtitle}>
            Verifică legătura la internet și încearcă din nou.
          </Text>
          <View style={{ height: 16 }} />
          <BigButton title="Înapoi" onPress={handleBack} variant="outline" />
        </View>
      </View>
    );
  }

  const harvest = merged.harvestStatus ?? 'planned';
  const harvestLabel = HARVEST_LABELS[harvest] ?? harvest;
  const harvestColor = HARVEST_COLORS[harvest] ?? '#94A3B8';
  const cropLabel = merged.cropType ? (CROP_LABELS[merged.cropType] ?? merged.cropType) : null;

  const hasBaleData = baleQuery.isSuccess;
  const remaining = Number(baleQuery.data?.remaining ?? 0);
  const produced = Number(baleQuery.data?.produced ?? 0);
  const loaded = Number(baleQuery.data?.loaded ?? 0);

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Parcelă" onBack={handleBack} />
      <ScrollView
        style={[styles.body, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#0A5C36" />
        }
      >
        {/* T9.3 — code is the canonical display name */}
        <View style={[styles.card, styles.headerCard]}>
          <Text style={styles.parcelCode}>{merged.code}</Text>
          <View style={styles.headerMetaRow}>
            <View style={[styles.statusPill, { backgroundColor: harvestColor }]}>
              <Text style={styles.statusPillText}>{harvestLabel}</Text>
            </View>
            <Text style={styles.areaText}>{formatHa(merged.areaHectares)}</Text>
          </View>
        </View>

        {/* Bales currently on the field (produced − loaded) */}
        <View style={[styles.card, styles.baleCard]}>
          <View style={styles.baleIconWrap}>
            <MaterialCommunityIcons name="package-variant-closed" size={26} color="#0A5C36" />
          </View>
          <View style={styles.rowItemBody}>
            <Text style={styles.rowItemLabel}>Baloti pe teren</Text>
            {baleQuery.isLoading ? (
              <ActivityIndicator color="#0A5C36" style={styles.baleLoader} />
            ) : (
              <Text style={styles.baleCount}>{hasBaleData ? remaining : '—'}</Text>
            )}
            {hasBaleData ? (
              <Text style={styles.baleSub}>
                produși {produced} · încărcați {loaded}
              </Text>
            ) : !baleQuery.isLoading ? (
              <Text style={styles.rowItemMuted}>indisponibil offline</Text>
            ) : null}
          </View>
        </View>

        {/* Crop type — T9.1 */}
        <View style={styles.card}>
          <View style={styles.rowItem}>
            <MaterialCommunityIcons name="grain" size={22} color="#B45309" />
            <View style={styles.rowItemBody}>
              <Text style={styles.rowItemLabel}>Cultură</Text>
              <Text style={styles.rowItemValue}>
                {cropLabel ?? <Text style={styles.rowItemMuted}>nedefinită</Text>}
              </Text>
            </View>
          </View>
        </View>

        {/* Location */}
        {(merged.municipality || merged.address) && (
          <View style={styles.card}>
            {merged.municipality ? (
              <View style={styles.rowItem}>
                <MaterialCommunityIcons name="map-marker" size={22} color="#0A5C36" />
                <View style={styles.rowItemBody}>
                  <Text style={styles.rowItemLabel}>Comună</Text>
                  <Text style={styles.rowItemValue}>{merged.municipality}</Text>
                </View>
              </View>
            ) : null}
            {merged.address ? (
              <View style={[styles.rowItem, styles.rowItemSpaced]}>
                <MaterialCommunityIcons name="road-variant" size={22} color="#0A5C36" />
                <View style={styles.rowItemBody}>
                  <Text style={styles.rowItemLabel}>Adresă</Text>
                  <Text style={styles.rowItemValue}>{merged.address}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Notes */}
        {merged.notes ? (
          <View style={styles.card}>
            <View style={styles.rowItem}>
              <MaterialCommunityIcons name="note-text-outline" size={22} color="#5D4037" />
              <View style={styles.rowItemBody}>
                <Text style={styles.rowItemLabel}>Note</Text>
                <Text style={styles.rowItemValue}>{merged.notes}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Quick actions */}
        <View style={styles.actions}>
          {primaryAction ? (
            <BigButton title={primaryAction.label} onPress={primaryAction.onPress} />
          ) : null}
          {navCoords ? (
            <Pressable onPress={handleNavigate} style={styles.navButton}>
              <MaterialCommunityIcons name="navigation-variant" size={20} color="#FFFFFF" />
              <Text style={styles.navButtonText}>Navighează până acolo</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onOpenMap} style={styles.secondaryButton}>
            <MaterialCommunityIcons name="map-search-outline" size={18} color="#0A5C36" />
            <Text style={styles.secondaryButtonText}>Deschide pe hartă</Text>
          </Pressable>
        </View>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  content: { padding: 16, gap: 12 },
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
  headerCard: { gap: 14 },
  parcelCode: { fontSize: 30, fontWeight: '800', color: '#0A5C36', letterSpacing: 0.5 },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  statusPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  areaText: { fontSize: 16, fontWeight: '600', color: '#5D4037' },
  baleCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  baleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  baleLoader: { alignSelf: 'flex-start', marginTop: 4 },
  baleCount: { fontSize: 28, fontWeight: '800', color: '#0A5C36' },
  baleSub: { fontSize: 13, color: '#5D4037' },
  rowItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowItemSpaced: { marginTop: 12 },
  rowItemBody: { flex: 1, gap: 2 },
  rowItemLabel: { fontSize: 12, fontWeight: '600', color: '#5D4037', textTransform: 'uppercase' },
  rowItemValue: { fontSize: 15, color: '#1F2937' },
  rowItemMuted: { color: '#94A3B8', fontStyle: 'italic' },
  actions: { gap: 10, marginTop: 4 },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#0A5C36',
  },
  navButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#0A5C36',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: { color: '#0A5C36', fontWeight: '700' },
  missingTitle: { fontSize: 18, fontWeight: '700', color: '#5D4037' },
  missingSubtitle: { fontSize: 14, color: '#5D4037', textAlign: 'center' },
});
