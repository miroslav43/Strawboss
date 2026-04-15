'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Pencil, MapPin, Trash2, Upload } from 'lucide-react';
import type { Parcel } from '@strawboss/types';
import { SearchInput } from '@/components/shared/SearchInput';
import { parseKml, type KmlParsedParcel } from '@/lib/kml-parser';
import { useI18n } from '@/lib/i18n';

interface FilterableParcelListProps {
  parcels: Parcel[];
  isLoading: boolean;
  selectedParcelId: string | null;
  onParcelSelect: (id: string) => void;
  onParcelEdit: (parcel: Parcel) => void;
  onParcelEditBoundary: (parcel: Parcel) => void;
  onParcelDelete: (id: string) => void;
  onParcelNavigate: (parcel: Parcel) => void;
  onKmlParsed: (parcels: KmlParsedParcel[]) => void;
  deleteIsPending: boolean;
}

export function FilterableParcelList({
  parcels,
  isLoading,
  selectedParcelId,
  onParcelSelect,
  onParcelEdit,
  onParcelEditBoundary,
  onParcelDelete,
  onParcelNavigate,
  onKmlParsed,
  deleteIsPending,
}: FilterableParcelListProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [kmlError, setKmlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const municipalities = useMemo(
    () => [...new Set(parcels.map((p) => p.municipality).filter((x): x is string => Boolean(x)))].sort(),
    [parcels],
  );

  const owners = useMemo(
    () => [...new Set(parcels.map((p) => p.ownerName).filter((x): x is string => Boolean(x)))].sort(),
    [parcels],
  );

  const filtered = useMemo(() => {
    return parcels.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        const matches = [p.name, p.code, p.ownerName, p.municipality]
          .some((field) => field?.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (municipalityFilter && p.municipality !== municipalityFilter) return false;
      if (ownerFilter && p.ownerName !== ownerFilter) return false;
      return true;
    });
  }, [parcels, search, municipalityFilter, ownerFilter]);

  const handleSearchChange = useCallback((v: string) => setSearch(v), []);

  const hasFilters = search || municipalityFilter || ownerFilter;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!fileInputRef.current) return;
      fileInputRef.current.value = '';
      if (!file) return;

      setKmlError(null);
      try {
        const text = await file.text();
        const parsed = parseKml(text);
        if (parsed.length === 0) {
          setKmlError(t('mapList.kmlNoPolygons'));
          return;
        }
        onKmlParsed(parsed);
      } catch (err) {
        setKmlError((err as Error)?.message ?? t('mapList.kmlReadError'));
      }
    },
    [onKmlParsed, t],
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t('mapList.parcels')}
        </p>
        <div className="flex items-center gap-1">
          {/* Import KML button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title={t('mapList.importKmlTooltip')}
            className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          >
            <Upload className="h-3 w-3" />
            {t('mapList.importKml')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kml"
            className="hidden"
            onChange={handleFileChange}
          />
          {/* Collapse toggle */}
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? t('mapList.hideList') : t('mapList.showList')}
            aria-label={open ? t('mapList.hideList') : t('mapList.showList')}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {kmlError && (
        <div className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {kmlError}
          <button onClick={() => setKmlError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {open && (
        <>
          {/* Filters */}
          <div className="space-y-1.5 border-b border-neutral-100 px-3 py-2">
            <SearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder={t('mapList.searchParcel')}
            />
            <div className="flex gap-1.5">
              <select
                value={municipalityFilter}
                onChange={(e) => setMunicipalityFilter(e.target.value)}
                className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
              >
                <option value="">{t('mapList.allMunicipalities')}</option>
                {municipalities.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
              >
                <option value="">{t('mapList.allOwners')}</option>
                {owners.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>

          {isLoading && (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">{t('common.loading')}</div>
          )}

          <ul className="divide-y divide-neutral-100">
            {filtered.map((parcel) => (
              <li
                key={parcel.id}
                className={`cursor-pointer px-4 py-3 transition-colors hover:bg-neutral-50 ${
                  selectedParcelId === parcel.id ? 'border-l-2 border-primary bg-amber-50' : ''
                }`}
                onClick={() => onParcelSelect(parcel.id)}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      {parcel.name ?? (
                        <span className="italic text-neutral-400">{t('leaflet.fieldNoName')}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {parcel.code}{parcel.municipality ? ` · ${parcel.municipality}` : ''}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {parcel.areaHectares != null ? `${parcel.areaHectares} ha` : '—'}
                    </p>
                    {parcel.ownerName && (
                      <p className="truncate text-xs text-neutral-400">
                        👤 {parcel.ownerName}
                      </p>
                    )}
                  </div>
                  {/* Navigate to parcel */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onParcelNavigate(parcel); }}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-500"
                    title={t('mapList.showOnMap')}
                    aria-label={t('mapList.showOnMap')}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  {/* Edit info */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onParcelEdit(parcel); }}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-primary"
                    title={t('mapList.editParcelInfo')}
                    aria-label={t('mapList.editParcelInfo')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {/* Edit boundary */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onParcelEditBoundary(parcel); }}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-600"
                    title={t('mapList.editParcelBoundary')}
                    aria-label={t('mapList.editParcelBoundary')}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </button>
                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onParcelDelete(parcel.id); }}
                    disabled={deleteIsPending}
                    className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    title={t('mapList.deleteParcelField')}
                    aria-label={t('mapList.deleteParcelField')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {!isLoading && filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-neutral-400">
                {hasFilters ? t('mapList.emptyFilteredParcels') : t('mapList.emptyNoParcels')}
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}
