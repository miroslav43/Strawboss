'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { Parcel, MachineLastLocation } from '@strawboss/types';
import { useUpdateParcelBoundary } from '@strawboss/api';
import { apiClient } from '@/lib/api';

// Default map center: Deta, Timiș
const DETA_CENTER: [number, number] = [45.3883, 21.2311];
const DEFAULT_ZOOM = 13;

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

const MACHINE_CFG: Record<string, { color: string; label: string; emoji: string }> = {
  baler:  { color: '#f59e0b', label: 'Baler',  emoji: '🌾' },
  loader: { color: '#3b82f6', label: 'Loader', emoji: '🔧' },
  truck:  { color: '#22c55e', label: 'Camion', emoji: '🚛' },
};

function getMachineCfg(type: string | null) {
  return MACHINE_CFG[type ?? ''] ?? { color: '#9ca3af', label: type ?? 'Mașină', emoji: '📍' };
}

function isOnline(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() < ONLINE_THRESHOLD_MS;
}

function timeAgo(recordedAt: string): string {
  const diff = Date.now() - new Date(recordedAt).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'chiar acum';
  if (mins < 60) return `${mins}m în urmă`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h în urmă`;
  return `${Math.floor(hrs / 24)}z în urmă`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMachineIcon(L: any, type: string | null, online: boolean) {
  const cfg  = getMachineCfg(type);
  const ring = online ? '#16a34a' : '#9ca3af';
  const html = `<div style="
    width:30px;height:30px;border-radius:50%;
    background:${cfg.color};border:3px solid ${ring};
    box-shadow:0 2px 6px rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;
    font-size:13px;line-height:1;
  ">${cfg.emoji}</div>`;
  return L.divIcon({ html, className: '', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -18] });
}

function parcelPopupHtml(p: Parcel): string {
  const btnBase = `
    cursor:pointer;border:1px solid #d1d5db;border-radius:6px;
    padding:4px 10px;font-size:11px;font-family:sans-serif;
    background:#fff;color:#374151;
  `;
  const displayName = p.name ?? `<em style="color:#9ca3af">Câmp fără nume</em>`;
  return `
    <div style="min-width:180px;font-family:sans-serif;line-height:1.5;">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${displayName}</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${p.code}</div>
      ${p.areaHectares != null ? `<div style="font-size:12px;color:#6b7280;">📐 ${p.areaHectares} ha</div>` : ''}
      ${p.municipality  ? `<div style="font-size:12px;color:#6b7280;">📍 ${p.municipality}</div>`  : ''}
      ${p.ownerName     ? `<div style="font-size:12px;color:#6b7280;">👤 ${p.ownerName}</div>`     : ''}
      <div style="margin-top:5px;font-size:11px;color:${p.isActive ? '#16a34a' : '#9ca3af'};">
        ${p.isActive ? '● Activ' : '○ Inactiv'}
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button data-edit-parcel-id="${p.id}" style="${btnBase}">✏️ Editează</button>
        <button data-delete-parcel-id="${p.id}" style="${btnBase}color:#dc2626;border-color:#fca5a5;">🗑️ Șterge</button>
      </div>
    </div>`;
}

function machinePopupHtml(m: MachineLastLocation): string {
  const cfg    = getMachineCfg(m.machineType);
  const online = isOnline(m.recordedAt);
  const ago    = timeAgo(m.recordedAt);
  return `
    <div style="min-width:180px;font-family:sans-serif;line-height:1.5;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">
        ${cfg.emoji} ${m.machineCode ?? cfg.label}
      </div>
      <div style="font-size:12px;color:#374151;">Tip: ${cfg.label}</div>
      ${m.operatorName ? `<div style="font-size:12px;color:#374151;">Operator: ${m.operatorName}</div>` : ''}
      <div style="margin-top:6px;font-size:11px;color:${online ? '#16a34a' : '#9ca3af'};">
        ${online ? '● Online' : '○ Offline'} · ${ago}
      </div>
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
  drawingNewParcel?: boolean;
  onNewParcelDrawn?: (geometry: GeoJSON.Geometry) => void;
  onDrawCancel?: () => void;
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
  drawingNewParcel,
  onNewParcelDrawn,
  onDrawCancel,
}: LeafletMapProps) {
  const mapRef           = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayersRef  = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machineLayersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editableLayerRef = useRef<any>(null);

  // Index parcels by id so popup button handlers can look up the full object.
  const parcelsIndexRef = useRef<Map<string, Parcel>>(new Map());
  useEffect(() => {
    parcelsIndexRef.current = new Map(parcels.map((p) => [p.id, p]));
  }, [parcels]);

  // Stable callback refs — always up-to-date inside async/event handlers.
  const onParcelSelectRef   = useRef(onParcelSelect);
  const onParcelEditRef     = useRef(onParcelEdit);
  const onParcelDeleteRef   = useRef(onParcelDelete);
  const onNewParcelDrawnRef = useRef(onNewParcelDrawn);
  const onDrawCancelRef     = useRef(onDrawCancel);
  useEffect(() => { onParcelSelectRef.current   = onParcelSelect;   }, [onParcelSelect]);
  useEffect(() => { onParcelEditRef.current     = onParcelEdit;     }, [onParcelEdit]);
  useEffect(() => { onParcelDeleteRef.current   = onParcelDelete;   }, [onParcelDelete]);
  useEffect(() => { onNewParcelDrawnRef.current = onNewParcelDrawn; }, [onNewParcelDrawn]);
  useEffect(() => { onDrawCancelRef.current     = onDrawCancel;     }, [onDrawCancel]);

  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [showParcels,  setShowParcels]  = useState(true);
  const [showMachines, setShowMachines] = useState(true);
  const [mapReady,     setMapReady]     = useState(false);

  // Ref so the global pm:create handler (registered once in map init) can read current editingId.
  const editingIdRef = useRef(editingId);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);

  const updateBoundary = useUpdateParcelBoundary(apiClient);

  // ── 1. Initialize map ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

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

      if (mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoom: DEFAULT_ZOOM, center: DETA_CENTER });

      // Force Leaflet to recalculate container dimensions after the dynamic import.
      // requestAnimationFrame ensures the browser has laid out the container before measuring.
      requestAnimationFrame(() => { map.invalidateSize(); map.setView(DETA_CENTER, DEFAULT_ZOOM); });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

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
      // Skip when in boundary-edit mode (editingIdRef) so the edit flow's
      // own once('pm:create') listener can handle it undisturbed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('pm:create', (e: any) => {
        if (editingIdRef.current) return; // boundary-edit flow handles this
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const feature = (e.layer as any).toGeoJSON() as GeoJSON.Feature;
        map.removeLayer(e.layer);
        onNewParcelDrawnRef.current?.(feature.geometry);
      });

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
      });

      mapInstanceRef.current = map;
      setMapReady(true);
    };

    void init();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          style: () => ({
            color:       isSelected ? '#e05d00' : '#4f7942',
            weight:      isSelected ? 3 : 2,
            fillOpacity: isSelected ? 0.25 : 0.15,
          }),
        })
          .bindPopup(parcelPopupHtml(parcel), { maxWidth: 280 })
          .on('click', () => onParcelSelectRef.current(parcel.id));

        // Permanent label: name (if set) on line 1, code smaller below.
        const labelLine1 = parcel.name ?? null;
        const labelLine2 = parcel.code;
        const labelHtml = labelLine1
          ? `<div style="font-weight:600;font-size:12px;color:#1a2e15;white-space:nowrap;">${labelLine1}</div>
             <div style="font-size:10px;color:#4f7942;white-space:nowrap;">${labelLine2}</div>`
          : `<div style="font-weight:600;font-size:11px;color:#4f7942;white-space:nowrap;">${labelLine2}</div>`;

        layer.bindTooltip(labelHtml, {
          permanent: true,
          direction: 'center',
          className: 'parcel-label',
        });

        if (showParcels) layer.addTo(map);
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
  }, [parcels, selectedParcelId, showParcels, mapReady]);

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
        const icon   = createMachineIcon(L, m.machineType, online);
        const marker = L.marker([m.lat, m.lon], { icon })
          .bindPopup(machinePopupHtml(m), { maxWidth: 260 });

        if (showMachines) marker.addTo(map);
        machineLayersRef.current.set(m.machineId, marker);
      });
    };

    void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, showMachines, mapReady]);

  // ── 4. Start boundary-edit when editParcel changes ──────────────────────
  useEffect(() => {
    if (editParcel && mapInstanceRef.current) {
      void handleStartEdit(editParcel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParcel]);

  // ── 5. New-parcel draw mode ──────────────────────────────────────────────
  // When "+ Câmp nou" is clicked, auto-enable polygon drawing mode on the map.
  // The actual pm:create handling lives in the global listener above (map init),
  // so users can also draw directly via the Geoman toolbar without clicking
  // "+ Câmp nou" first.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (!drawingNewParcel) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).pm.enableDraw('Polygon', { snappable: true });

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).pm.disableDraw();
    };
  }, [drawingNewParcel, mapReady]);

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
        onError: (err) => setSaveError((err as Error)?.message ?? 'Save failed'),
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

      {/* Layer toggle */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1 rounded-xl bg-white px-3 py-2 shadow-lg text-sm">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={showParcels}  onChange={(e) => setShowParcels(e.target.checked)}  className="accent-green-600" />
          <span className="text-neutral-700">Parcele</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={showMachines} onChange={(e) => setShowMachines(e.target.checked)} className="accent-amber-500" />
          <span className="text-neutral-700">Mașini</span>
        </label>
      </div>

      {/* Fit-to-bounds button */}
      <button
        onClick={handleFitBounds}
        title="Fit all fields in view"
        className="absolute right-3 top-[88px] z-[1000] rounded-lg bg-white p-2 shadow-lg hover:bg-neutral-50 transition-colors"
      >
        <Maximize2 className="h-4 w-4 text-neutral-600" />
      </button>

      {/* Drawing new parcel instruction banner */}
      {drawingNewParcel && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-amber-800">
            Desenează poligonul câmpului pe hartă
          </span>
          <button
            onClick={() => onDrawCancelRef.current?.()}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            Anulează
          </button>
        </div>
      )}

      {/* Edit-boundary controls bar */}
      {editingId && !drawingNewParcel && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-neutral-700">
            Editezi limita pentru{' '}
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
            {updateBoundary.isPending ? 'Se salvează…' : 'Salvează limita'}
          </button>
          <button
            onClick={handleCancelEdit}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Anulează
          </button>
        </div>
      )}
    </div>
  );
}
