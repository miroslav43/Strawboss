'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Plus, Warehouse } from 'lucide-react';
import type { Parcel, MachineLastLocation, RoutePoint, DeliveryDestination } from '@strawboss/types';
import { HarvestStatus } from '@strawboss/types';
import { useUpdateParcelBoundary } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { getMachineVisual } from './machine-icons';
import type { IconVariant } from './machine-icons';
import type { IconPrefs } from '@/hooks/useMachineIconPrefs';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Default map center: Deta, Timiș
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 13;

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;


function isOnline(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() < ONLINE_THRESHOLD_MS;
}

type MapStrings = {
  fieldNoName: string;
  editParcelBtn: string;
  deleteParcelBtn: string;
  typeLabel: string;
  operatorLabel: string;
  machineUnknown: string;
  statusActive: string;
  statusInactive: string;
  harvestStatusLabel: string;
  labelHarvestStatus: (status: string | undefined) => string;
  onlineStatus: string;
  offlineStatus: string;
  showRoute: string;
  routeStart: string;
  routeEnd: string;
  formatAgo: (recordedAt: string) => string;
};

function getParcelPolygonStyle(
  parcel: Pick<Parcel, 'harvestStatus'>,
  isSelected: boolean,
): { color: string; weight: number; fillOpacity: number; fillColor?: string } {
  if (isSelected) {
    return { color: '#dc2626', weight: 3, fillOpacity: 0.3 };
  }
  const hs = parcel.harvestStatus ?? HarvestStatus.planned;
  switch (hs) {
    case HarvestStatus.harvesting:
      return {
        color: '#eab308',
        weight: 2,
        fillColor: '#facc15',
        fillOpacity: 0.28,
      };
    case HarvestStatus.harvested:
      return {
        color: '#b91c1c',
        weight: 2,
        fillColor: '#fecaca',
        fillOpacity: 0.35,
      };
    case HarvestStatus.planned:
    case HarvestStatus.to_harvest:
      return { color: '#f97316', weight: 2, fillOpacity: 0.18 };
    default:
      return { color: '#f97316', weight: 2, fillOpacity: 0.18 };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMachineIcon(
  L: any,
  type: string | null,
  online: boolean,
  pickSelected = false,
  variant: IconVariant = 0,
) {
  const cfg  = getMachineVisual(type, variant);
  const ring = pickSelected ? '#dc2626' : online ? '#16a34a' : '#9ca3af';
  const html = `<div style="width:34px;height:34px;border-radius:8px;background:${cfg.color};border:3px solid ${ring};box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;overflow:visible;">${cfg.svg}</div>`;
  return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -20] });
}

function parcelPopupHtml(p: Parcel, s: MapStrings, selectionOnly: boolean): string {
  const btnBase = `
    cursor:pointer;border:1px solid #d1d5db;border-radius:6px;
    padding:4px 10px;font-size:11px;font-family:sans-serif;
    background:#fff;color:#374151;
  `;
  const displayName = p.name ? esc(p.name) : `<em style="color:#9ca3af">${esc(s.fieldNoName)}</em>`;
  const status = p.isActive ? s.statusActive : s.statusInactive;
  const actionRow = selectionOnly
    ? ''
    : `<div style="margin-top:8px;display:flex;gap:6px;">
        <button data-edit-parcel-id="${esc(p.id)}" style="${btnBase}">${esc(s.editParcelBtn)}</button>
        <button data-delete-parcel-id="${esc(p.id)}" style="${btnBase}color:#dc2626;border-color:#fca5a5;">${esc(s.deleteParcelBtn)}</button>
      </div>`;
  return `
    <div style="min-width:180px;font-family:sans-serif;line-height:1.5;">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${displayName}</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${esc(p.code)}</div>
      ${p.areaHectares != null ? `<div style="font-size:12px;color:#6b7280;">${p.areaHectares} ha</div>` : ''}
      ${p.municipality  ? `<div style="font-size:12px;color:#6b7280;">${esc(p.municipality)}</div>`  : ''}
      ${p.ownerName     ? `<div style="font-size:12px;color:#6b7280;">${esc(p.ownerName)}</div>`     : ''}
      <div style="margin-top:4px;font-size:11px;color:#6b7280;">
        ${esc(s.harvestStatusLabel)}: ${esc(s.labelHarvestStatus(p.harvestStatus))}
      </div>
      <div style="margin-top:5px;font-size:11px;color:${p.isActive ? '#16a34a' : '#9ca3af'};">
        ${esc(status)}
      </div>
      ${actionRow}
    </div>`;
}

function machinePopupHtml(
  m: MachineLastLocation,
  s: MapStrings,
  typeLabel: string,
  selectionOnly: boolean,
): string {
  const online = isOnline(m.recordedAt);
  const ago    = s.formatAgo(m.recordedAt);
  const btnBase = `
    cursor:pointer;border:1px solid #d1d5db;border-radius:6px;
    padding:4px 10px;font-size:11px;font-family:sans-serif;
    background:#fff;color:#374151;
  `;
  const title = esc(m.machineCode ?? typeLabel);
  const line = `${esc(s.typeLabel)}: ${esc(typeLabel)}`;
  const status = online ? s.onlineStatus : s.offlineStatus;
  const routeRow = selectionOnly
    ? ''
    : `<div style="margin-top:8px;">
        <button data-show-route-machine-id="${esc(m.machineId)}" style="${btnBase}color:#3b82f6;border-color:#93c5fd;">${esc(s.showRoute)}</button>
      </div>`;
  return `
    <div style="min-width:180px;font-family:sans-serif;line-height:1.5;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">
        ${title}
      </div>
      <div style="font-size:12px;color:#374151;">${line}</div>
      ${m.operatorName ? `<div style="font-size:12px;color:#374151;">${esc(s.operatorLabel)}: ${esc(m.operatorName)}</div>` : ''}
      <div style="margin-top:6px;font-size:11px;color:${online ? '#16a34a' : '#9ca3af'};">
        ${esc(status)} · ${esc(ago)}
      </div>
      ${routeRow}
    </div>`;
}

export interface LeafletMapProps {
  parcels: Parcel[];
  machines: MachineLastLocation[];
  selectedParcelId: string | null;
  onParcelSelect: (id: string) => void;
  onParcelEdit: (parcel: Parcel) => void;
  onParcelDelete: (id: string) => void;
  editParcel?: Parcel | null;
  onEditDone?: () => void;
  /** When set, enables polygon draw and routes the next shape to parcel or deposit flow. */
  drawMode?: 'parcel' | 'deposit' | null;
  onDrawModeChange?: (mode: 'parcel' | 'deposit' | null) => void;
  onNewParcelDrawn?: (geometry: GeoJSON.Geometry) => void;
  onNewDepositDrawn?: (geometry: GeoJSON.Geometry) => void;
  onDrawCancel?: () => void;
  /** Route history polyline points (chronological order). */
  routePoints?: RoutePoint[];
  /** Trigger: pan/zoom to this parcel, then reset via onNavigationComplete. */
  navigateToParcelId?: string | null;
  /** Trigger: pan/zoom to this machine, then reset via onNavigationComplete. */
  navigateToMachineId?: string | null;
  onNavigationComplete?: () => void;
  /** Called when user clicks "Arată traseu" in a machine popup. */
  onShowRoute?: (machineId: string) => void;
  /** Parcel IDs to hide on map (farm/parcel toggles from sidebar). */
  hiddenParcelIds?: Set<string>;
  /** Machine IDs to hide individually on map. */
  hiddenMachineIds?: Set<string>;
  /** Delivery destinations to show as blue polygons. */
  deposits?: DeliveryDestination[];
  /** Deposit IDs to hide. */
  hiddenDepositIds?: Set<string>;
  /** Highlight when picking a deposit on the map (e.g. task truck modal). */
  selectedDepositId?: string | null;
  /** When set, clicking a deposit polygon calls this (in addition to popup). */
  onDepositSelect?: (id: string) => void;
  /** Highlight when picking a machine marker (e.g. loader picker modal). */
  selectedMachineId?: string | null;
  /** When set, clicking a machine marker calls this (popup still opens). */
  onMachineMarkerSelect?: (machineId: string) => void;
  /** Hide editing tools, layer toggles, and draw UI — map is click-to-select only. */
  selectionOnly?: boolean;
  /** Per-machine icon variant map (machineId → 0|1|2). Loaded from localStorage by the parent. */
  iconPrefs?: IconPrefs;
}

export function LeafletMap({
  parcels,
  machines,
  selectedParcelId,
  onParcelSelect,
  onParcelEdit,
  onParcelDelete,
  editParcel,
  onEditDone,
  drawMode = null,
  onDrawModeChange,
  onNewParcelDrawn,
  onNewDepositDrawn,
  onDrawCancel,
  routePoints,
  navigateToParcelId,
  navigateToMachineId,
  onNavigationComplete,
  onShowRoute,
  hiddenParcelIds,
  hiddenMachineIds,
  deposits,
  hiddenDepositIds,
  selectedDepositId = null,
  onDepositSelect,
  selectedMachineId = null,
  onMachineMarkerSelect,
  selectionOnly = false,
  iconPrefs = {},
}: LeafletMapProps) {
  const { t } = useI18n();

  const mapStrings = useMemo((): MapStrings => {
    const formatAgo = (recordedAt: string) => {
      const diff = Date.now() - new Date(recordedAt).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return t('leaflet.justNow');
      if (mins < 60) return t('leaflet.minsAgo', { n: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return t('leaflet.hoursAgo', { n: hrs });
      return t('leaflet.daysAgo', { n: Math.floor(hrs / 24) });
    };
    return {
      fieldNoName: t('leaflet.fieldNoName'),
      editParcelBtn: t('leaflet.editParcelBtn'),
      deleteParcelBtn: t('leaflet.deleteParcelBtn'),
      typeLabel: t('leaflet.typeLabel'),
      operatorLabel: t('leaflet.operatorLabel'),
      machineUnknown: t('leaflet.machineUnknown'),
      statusActive: t('leaflet.statusActive'),
      statusInactive: t('leaflet.statusInactive'),
      harvestStatusLabel: t('leaflet.harvestStatus'),
      labelHarvestStatus: (status: string | undefined) => {
        switch (status ?? HarvestStatus.planned) {
          case HarvestStatus.planned:
            return t('parcels.harvest.planned');
          case HarvestStatus.to_harvest:
            return t('parcels.harvest.to_harvest');
          case HarvestStatus.harvesting:
            return t('parcels.harvest.harvesting');
          case HarvestStatus.harvested:
            return t('parcels.harvest.harvested');
          default:
            return t('parcels.harvest.planned');
        }
      },
      onlineStatus: t('leaflet.onlineStatus'),
      offlineStatus: t('leaflet.offlineStatus'),
      showRoute: t('leaflet.showRoute'),
      routeStart: t('leaflet.routeStart'),
      routeEnd: t('leaflet.routeEnd'),
      formatAgo,
    };
  }, [t]);

  const machineTypeLabel = useCallback(
    (type: string | null) => {
      if (type === 'truck') return t('leaflet.trucks');
      if (type === 'baler') return t('leaflet.balers');
      if (type === 'loader') return t('leaflet.loaders');
      return type || t('leaflet.machineUnknown');
    },
    [t],
  );

  const mapRef           = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayersRef  = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machineLayersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depositLayersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editableLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeLayerRef = useRef<any>(null);

  // Index parcels by id so popup button handlers can look up the full object.
  const parcelsIndexRef = useRef<Map<string, Parcel>>(new Map());
  useEffect(() => {
    parcelsIndexRef.current = new Map(parcels.map((p) => [p.id, p]));
  }, [parcels]);

  // Stable callback refs — always up-to-date inside async/event handlers.
  const onParcelSelectRef   = useRef(onParcelSelect);
  const onParcelEditRef     = useRef(onParcelEdit);
  const onParcelDeleteRef   = useRef(onParcelDelete);
  const onNewParcelDrawnRef   = useRef(onNewParcelDrawn);
  const onNewDepositDrawnRef  = useRef(onNewDepositDrawn);
  const onDrawCancelRef       = useRef(onDrawCancel);
  const drawModeRef           = useRef(drawMode);
  useEffect(() => { onParcelSelectRef.current   = onParcelSelect;   }, [onParcelSelect]);
  useEffect(() => { onParcelEditRef.current     = onParcelEdit;     }, [onParcelEdit]);
  useEffect(() => { onParcelDeleteRef.current   = onParcelDelete;   }, [onParcelDelete]);
  useEffect(() => { onNewParcelDrawnRef.current = onNewParcelDrawn; }, [onNewParcelDrawn]);
  useEffect(() => { onNewDepositDrawnRef.current = onNewDepositDrawn; }, [onNewDepositDrawn]);
  useEffect(() => { onDrawCancelRef.current     = onDrawCancel;     }, [onDrawCancel]);
  useEffect(() => { drawModeRef.current         = drawMode;         }, [drawMode]);

  const onShowRouteRef = useRef(onShowRoute);
  useEffect(() => { onShowRouteRef.current = onShowRoute; }, [onShowRoute]);

  const onDepositSelectRef = useRef(onDepositSelect);
  const onMachineMarkerSelectRef = useRef(onMachineMarkerSelect);
  useEffect(() => { onDepositSelectRef.current = onDepositSelect; }, [onDepositSelect]);
  useEffect(() => {
    onMachineMarkerSelectRef.current = onMachineMarkerSelect;
  }, [onMachineMarkerSelect]);

  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [showParcels, setShowParcels] = useState(true);
  const [showTrucks,  setShowTrucks]  = useState(true);
  const [showBalers,  setShowBalers]  = useState(true);
  const [showLoaders,  setShowLoaders]  = useState(true);
  const [showDeposits, setShowDeposits] = useState(true);
  const [mapReady,     setMapReady]     = useState(false);

  const drawToolsDisabled = !!editParcel || !!editingId;

  // Ref so the global pm:create handler (registered once in map init) can read current editingId.
  const editingIdRef = useRef(editingId);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);

  const updateBoundary = useUpdateParcelBoundary(apiClient);

  // ── 1. Initialize map ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    let isMounted = true;

    const init = async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      await import('@geoman-io/leaflet-geoman-free');
      await import('@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (!isMounted || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoom: DEFAULT_ZOOM, center: DETA_CENTER });

      // Force Leaflet to recalculate container dimensions after the dynamic import.
      // requestAnimationFrame ensures the browser has laid out the container before measuring.
      requestAnimationFrame(() => { map.invalidateSize(); map.setView(DETA_CENTER, DEFAULT_ZOOM); });

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, IGN',
        },
      ).addTo(map);

      if (!selectionOnly) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any).pm.addControls({
          position:         'topleft',
          drawMarker:       false,
          drawCircle:       false,
          drawCircleMarker: false,
          drawPolyline:     false,
          drawRectangle:    true,
          drawPolygon:      true,
          editMode:         true,
          dragMode:         true,
          cutPolygon:       false,
          removalMode:      false,
        });

        // Global pm:create handler — catches draws from the Geoman toolbar directly,
        // not just when the "+ Câmp nou" button starts draw mode.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on('pm:create', (e: any) => {
          if (editingIdRef.current) return; // boundary-edit flow handles this
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const feature = (e.layer as any).toGeoJSON() as GeoJSON.Feature;
          map.removeLayer(e.layer);
          if (drawModeRef.current === 'deposit') {
            onNewDepositDrawnRef.current?.(feature.geometry);
          } else {
            onNewParcelDrawnRef.current?.(feature.geometry);
          }
        });
      }

      // Popup button delegation — Edit / Delete buttons inside parcel popups.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('popupopen', (e: any) => {
        const container = e.popup.getElement() as HTMLElement | null;
        if (!container) return;

        const editBtn   = container.querySelector('[data-edit-parcel-id]') as HTMLElement | null;
        const deleteBtn = container.querySelector('[data-delete-parcel-id]') as HTMLElement | null;

        if (editBtn) {
          const parcelId = editBtn.getAttribute('data-edit-parcel-id');
          editBtn.onclick = () => {
            if (!parcelId) return;
            const parcel = parcelsIndexRef.current.get(parcelId);
            if (parcel) onParcelEditRef.current(parcel);
            map.closePopup();
          };
        }

        if (deleteBtn) {
          const parcelId = deleteBtn.getAttribute('data-delete-parcel-id');
          deleteBtn.onclick = () => {
            if (!parcelId) return;
            onParcelDeleteRef.current(parcelId);
            map.closePopup();
          };
        }

        const routeBtn = container.querySelector('[data-show-route-machine-id]') as HTMLElement | null;
        if (routeBtn) {
          const mid = routeBtn.getAttribute('data-show-route-machine-id');
          routeBtn.onclick = () => {
            if (!mid) return;
            onShowRouteRef.current?.(mid);
            map.closePopup();
          };
        }
      });

      mapInstanceRef.current = map;
      setMapReady(true);
    };

    void init();

    return () => {
      isMounted = false;
      setMapReady(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // selectionOnly determines whether Geoman controls and pm:create are registered at init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionOnly]);

  // When the map container's box changes (e.g. left sidebar collapse on /map),
  // Leaflet must re-measure — window "resize" does not fire for flex layout changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const el = mapRef.current;
    if (!map || !mapReady || !el) return;

    let raf = 0;
    const scheduleInvalidate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
      });
    };

    scheduleInvalidate();

    const ro = new ResizeObserver(() => {
      scheduleInvalidate();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mapReady]);

  // ── 2. Sync parcel polygons ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const render = async () => {
      const L = (await import('leaflet')).default;

      parcelLayersRef.current.forEach((layer) => map.removeLayer(layer));
      parcelLayersRef.current.clear();

      const bounds: [number, number][] = [];

      parcels.forEach((parcel) => {
        const boundary = parcel.boundary as unknown as GeoJSON.Geometry | null;
        if (!boundary) return;

        const isSelected = parcel.id === selectedParcelId;
        const layer = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
          style: () => getParcelPolygonStyle(parcel, isSelected),
        })
          .bindPopup(parcelPopupHtml(parcel, mapStrings, selectionOnly), { maxWidth: 280 })
          .on('click', () => onParcelSelectRef.current(parcel.id));

        // Permanent label: name (if set) on line 1, code smaller below.
        const labelLine1 = parcel.name ?? null;
        const labelLine2 = parcel.code;
        const labelHtml = labelLine1
          ? `<div style="font-weight:600;font-size:12px;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.7);">${esc(labelLine1)}</div>
             <div style="font-size:10px;color:#fed7aa;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.6);">${esc(labelLine2)}</div>`
          : `<div style="font-weight:600;font-size:11px;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.7);">${esc(labelLine2)}</div>`;

        layer.bindTooltip(labelHtml, {
          permanent: false,
          direction: 'center',
          className: 'parcel-label',
          sticky: false,
        });

        if (showParcels && !hiddenParcelIds?.has(parcel.id)) layer.addTo(map);
        parcelLayersRef.current.set(parcel.id, layer);

        const b = layer.getBounds();
        if (b.isValid()) {
          bounds.push([b.getSouthWest().lat, b.getSouthWest().lng]);
          bounds.push([b.getNorthEast().lat, b.getNorthEast().lng]);
        }
      });
      // Intentionally NOT calling fitBounds here — map always stays at the
      // initial Deta center. Use the maximize button to fit all parcels.
      void bounds;
    };

    void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, selectedParcelId, showParcels, hiddenParcelIds, mapReady, mapStrings, selectionOnly]);

  // ── 3. Sync machine markers ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const render = async () => {
      const L = (await import('leaflet')).default;

      machineLayersRef.current.forEach((marker) => map.removeLayer(marker));
      machineLayersRef.current.clear();

      machines.forEach((m) => {
        const online = isOnline(m.recordedAt);
        const pickSelected = selectedMachineId != null && m.machineId === selectedMachineId;
        const variant = (iconPrefs[m.machineId] ?? 0) as IconVariant;
        const icon = createMachineIcon(L, m.machineType, online, pickSelected, variant);
        const marker = L.marker([m.lat, m.lon], { icon })
          .bindPopup(
            machinePopupHtml(m, mapStrings, machineTypeLabel(m.machineType), selectionOnly),
            { maxWidth: 260 },
          );

        marker.on('click', () => {
          onMachineMarkerSelectRef.current?.(m.machineId);
        });

        const typeVisible =
          (m.machineType === 'truck'  && showTrucks)  ||
          (m.machineType === 'baler'  && showBalers)  ||
          (m.machineType === 'loader' && showLoaders) ||
          (!['truck', 'baler', 'loader'].includes(m.machineType ?? '') && showTrucks);
        if (typeVisible && !hiddenMachineIds?.has(m.machineId)) marker.addTo(map);
        machineLayersRef.current.set(m.machineId, marker);
      });
    };

    void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    machines,
    showTrucks,
    showBalers,
    showLoaders,
    hiddenMachineIds,
    mapReady,
    mapStrings,
    machineTypeLabel,
    selectedMachineId,
    selectionOnly,
    iconPrefs,
  ]);

  // ── 3b. Sync deposit polygons (blue) ────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const render = async () => {
      const L = (await import('leaflet')).default;

      depositLayersRef.current.forEach((layer) => map.removeLayer(layer));
      depositLayersRef.current.clear();

      if (!deposits) return;

      deposits.forEach((d) => {
        const boundary = d.boundary as unknown as GeoJSON.Geometry | null;
        if (!boundary) return;

        const isSelected = d.id === selectedDepositId;
        const layer = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
          style: () => ({
            color: isSelected ? '#b91c1c' : '#2563eb',
            weight: isSelected ? 3 : 2,
            fillColor: isSelected ? '#fecaca' : '#3b82f6',
            fillOpacity: isSelected ? 0.35 : 0.2,
            dashArray: '6 4',
          }),
        }).bindPopup(
          `<div style="min-width:160px;font-family:sans-serif;line-height:1.5;">
            <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${esc(d.name)}</div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${esc(d.code)}</div>
            ${d.address ? `<div style="font-size:12px;color:#6b7280;">${esc(d.address)}</div>` : ''}
            ${d.contactName ? `<div style="font-size:12px;color:#6b7280;">${esc(d.contactName)}</div>` : ''}
          </div>`,
          { maxWidth: 260 },
        );

        layer.on('click', () => {
          onDepositSelectRef.current?.(d.id);
        });

        layer.bindTooltip(
          `<div style="font-weight:600;font-size:11px;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.7);">${esc(d.name)}</div>`,
          { permanent: false, direction: 'center', className: 'deposit-label', sticky: false },
        );

        if (showDeposits && !hiddenDepositIds?.has(d.id)) layer.addTo(map);
        depositLayersRef.current.set(d.id, layer);
      });
    };

    void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deposits, showDeposits, hiddenDepositIds, mapReady, selectedDepositId]);

  // ── 4. Start boundary-edit when editParcel changes ──────────────────────
  useEffect(() => {
    if (selectionOnly) return;
    if (editParcel && mapInstanceRef.current) {
      void handleStartEdit(editParcel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParcel, selectionOnly]);

  // ── 5. Draw mode (parcel or deposit) ─────────────────────────────────────
  // Auto-enable polygon draw when a mode is selected; Geoman toolbar still works
  // for parcel flow when drawMode is null (pm:create defaults to parcel).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (selectionOnly) return;
    if (drawMode !== 'parcel' && drawMode !== 'deposit') return;

    const parcelStyle = {
      snappable: true,
      pathOptions: {
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.22,
      },
    };
    const depositStyle = {
      snappable: true,
      pathOptions: {
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.22,
        dashArray: '6 4',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).pm.enableDraw(
      'Polygon',
      drawMode === 'deposit' ? depositStyle : parcelStyle,
    );

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).pm.disableDraw();
    };
  }, [drawMode, mapReady, selectionOnly]);

  // ── 6. Render route history polyline ────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    // Clear previous route
    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (!routePoints || routePoints.length < 2) return;

    const render = async () => {
      const L = (await import('leaflet')).default;
      const latLngs = routePoints.map((p) => [p.lat, p.lon] as [number, number]);

      const polyline = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.8,
        dashArray: '8 4',
      });

      const startMarker = L.circleMarker(latLngs[0], {
        radius: 6, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1,
      }).bindTooltip(mapStrings.routeStart, { permanent: false });

      const endMarker = L.circleMarker(latLngs[latLngs.length - 1], {
        radius: 6, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1,
      }).bindTooltip(mapStrings.routeEnd, { permanent: false });

      const group = L.layerGroup([polyline, startMarker, endMarker]).addTo(map);
      routeLayerRef.current = group;

      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    };

    void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints, mapReady, mapStrings.routeStart, mapStrings.routeEnd]);

  // ── 7. Navigate to parcel ──────────────────────────────────────────────
  useEffect(() => {
    if (!navigateToParcelId || !mapInstanceRef.current || !mapReady) return;

    const layer = parcelLayersRef.current.get(navigateToParcelId);
    if (layer) {
      const bounds = layer.getBounds?.();
      if (bounds?.isValid()) {
        mapInstanceRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
        layer.openPopup();
      }
    }
    onNavigationComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateToParcelId, mapReady]);

  // ── 8. Navigate to machine ─────────────────────────────────────────────
  useEffect(() => {
    if (!navigateToMachineId || !mapInstanceRef.current || !mapReady) return;

    const marker = machineLayersRef.current.get(navigateToMachineId);
    if (marker) {
      mapInstanceRef.current.setView(marker.getLatLng(), 16, { animate: true });
      marker.openPopup();
    }
    onNavigationComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateToMachineId, mapReady]);

  // ── Edit-boundary handlers ───────────────────────────────────────────────
  const handleStartEdit = async (parcel: Parcel) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const L       = (await import('leaflet')).default;
    const boundary = parcel.boundary as unknown as GeoJSON.Geometry | null;

    if (editableLayerRef.current) {
      map.removeLayer(editableLayerRef.current);
      editableLayerRef.current = null;
    }

    setEditingId(parcel.id);
    setSaveError(null);

    if (boundary) {
      const layer = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
        style: { color: '#e05d00', weight: 2, fillOpacity: 0.25 },
      }).addTo(map);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (layer as any).pm.enable({ allowSelfIntersection: false });
      editableLayerRef.current = layer;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).pm.enableDraw('Polygon', { snappable: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.once('pm:create', (e: any) => {
        editableLayerRef.current = e.layer;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e.layer as any).pm.enable({ allowSelfIntersection: false });
      });
    }
  };

  const handleSave = () => {
    if (!editingId || !editableLayerRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer    = editableLayerRef.current as any;
    const geoJSON: GeoJSON.Feature =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (layer as any).toGeoJSON?.() ?? (layer as any).getLayers?.()[0]?.toGeoJSON();

    updateBoundary.mutate(
      { id: editingId, boundary: geoJSON.geometry },
      {
        onSuccess: () => {
          setEditingId(null);
          if (editableLayerRef.current) {
            mapInstanceRef.current?.removeLayer(editableLayerRef.current);
            editableLayerRef.current = null;
          }
          onEditDone?.();
        },
        onError: (err) => setSaveError((err as Error)?.message ?? t('leaflet.saveBoundaryFailed')),
      },
    );
  };

  const handleCancelEdit = () => {
    if (editableLayerRef.current) {
      mapInstanceRef.current?.removeLayer(editableLayerRef.current);
      editableLayerRef.current = null;
    }
    setEditingId(null);
    setSaveError(null);
    onEditDone?.();
  };

  const handleFitBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const bounds: [number, number][] = [];
    parcelLayersRef.current.forEach((layer) => {
      const b = layer.getBounds?.();
      if (b?.isValid()) {
        bounds.push([b.getSouthWest().lat, b.getSouthWest().lng]);
        bounds.push([b.getNorthEast().lat,  b.getNorthEast().lng]);
      }
    });
    if (bounds.length > 0) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
    } else {
      map.setView(DETA_CENTER, DEFAULT_ZOOM);
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />

      {/* Layer toggles + draw tools + fit (hidden in selection-only modals) */}
      {!selectionOnly && (
      <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <div className="flex flex-col gap-1 rounded-xl bg-white/95 backdrop-blur-sm px-3 py-2 shadow-lg text-sm">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={showParcels} onChange={(e) => setShowParcels(e.target.checked)} className="accent-green-600" />
            <span className="text-neutral-700">{t('leaflet.parcels')}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={showDeposits} onChange={(e) => setShowDeposits(e.target.checked)} className="accent-blue-600" />
            <span className="text-neutral-700">{t('leaflet.deposits')}</span>
          </label>
          <div className="my-0.5 border-t border-neutral-200" />
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={showTrucks} onChange={(e) => setShowTrucks(e.target.checked)} className="accent-green-500" />
            <span className="text-neutral-700">{t('leaflet.trucks')}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={showBalers} onChange={(e) => setShowBalers(e.target.checked)} className="accent-amber-500" />
            <span className="text-neutral-700">{t('leaflet.balers')}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={showLoaders} onChange={(e) => setShowLoaders(e.target.checked)} className="accent-blue-500" />
            <span className="text-neutral-700">{t('leaflet.loaders')}</span>
          </label>
          <div className="my-0.5 border-t border-neutral-200" />
          <button
            type="button"
            disabled={drawToolsDisabled}
            onClick={() =>
              onDrawModeChange?.(drawMode === 'parcel' ? null : 'parcel')
            }
            title={t('map.drawNewFieldTooltip')}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              drawMode === 'parcel'
                ? 'border-amber-400 bg-amber-100 text-amber-900'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-amber-50'
            }`}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {t('map.drawNewField')}
          </button>
          <button
            type="button"
            disabled={drawToolsDisabled}
            onClick={() =>
              onDrawModeChange?.(drawMode === 'deposit' ? null : 'deposit')
            }
            title={t('map.drawDepositGeofenceTooltip')}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              drawMode === 'deposit'
                ? 'border-blue-500 bg-blue-100 text-blue-900'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-blue-50'
            }`}
          >
            <Warehouse className="h-3.5 w-3.5 shrink-0" />
            {t('map.drawDepositGeofence')}
          </button>
        </div>
        <button
          type="button"
          onClick={handleFitBounds}
          title={t('leaflet.fitBounds')}
          aria-label={t('leaflet.fitBounds')}
          className="rounded-lg bg-white p-2 shadow-lg hover:bg-neutral-50 transition-colors"
        >
          <Maximize2 className="h-4 w-4 text-neutral-600" />
        </button>
      </div>
      )}

      {/* Draw-mode instruction banner */}
      {!selectionOnly && drawMode === 'parcel' && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-amber-800">
            {t('leaflet.drawHint')}
          </span>
          <button
            type="button"
            onClick={() => onDrawCancelRef.current?.()}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
      {!selectionOnly && drawMode === 'deposit' && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-200 px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-blue-900">
            {t('map.depositGeofence.drawHint')}
          </span>
          <button
            type="button"
            onClick={() => onDrawCancelRef.current?.()}
            className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Edit-boundary controls bar */}
      {!selectionOnly && editingId && !drawMode && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-neutral-700">
            {t('leaflet.editingBoundary')}{' '}
            <span className="text-primary">
              {parcels.find((p) => p.id === editingId)?.name ?? parcels.find((p) => p.id === editingId)?.code ?? editingId}
            </span>
          </span>
          {saveError && <span className="text-xs text-red-500">{saveError}</span>}
          <button
            onClick={handleSave}
            disabled={updateBoundary.isPending}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {updateBoundary.isPending ? t('map.savingShort') : t('leaflet.saveBoundary')}
          </button>
          <button
            onClick={handleCancelEdit}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
