'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Warehouse, X, Loader2, Check } from 'lucide-react';
import {
  useCreateDeliveryDestination,
  useUpdateDeliveryDestination,
} from '@strawboss/api';
import type { DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function hasDepositBoundary(d: DeliveryDestination): boolean {
  const b = d.boundary as unknown;
  if (b == null) return false;
  if (typeof b === 'string') return b.trim().length > 0;
  if (typeof b === 'object') return true;
  return false;
}

export interface DepositGeofenceModalProps {
  geometry: GeoJSON.Geometry;
  deposits: DeliveryDestination[];
  onClose: () => void;
}

type TabKey = 'existing' | 'new';

export function DepositGeofenceModal({
  geometry,
  deposits,
  onClose,
}: DepositGeofenceModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>('existing');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const createDeposit = useCreateDeliveryDestination(apiClient);
  const updateDeposit = useUpdateDeliveryDestination(apiClient);
  const isPending = createDeposit.isPending || updateDeposit.isPending;

  /** Deposits that do not have a map boundary yet — cannot attach a second geofence from here. */
  const eligibleDeposits = useMemo(
    () =>
      [...deposits]
        .filter((d) => !hasDepositBoundary(d))
        .sort((a, b) =>
          (a.name || a.code).localeCompare(b.name || b.code, 'ro', {
            sensitivity: 'base',
          }),
        ),
    [deposits],
  );

  useEffect(() => {
    if (selectedId && !eligibleDeposits.some((d) => d.id === selectedId)) {
      setSelectedId('');
    }
  }, [eligibleDeposits, selectedId]);

  const handleAttachExisting = useCallback(() => {
    setError('');
    if (!selectedId) {
      setError(t('map.depositGeofence.selectDepositError'));
      return;
    }
    if (!eligibleDeposits.some((d) => d.id === selectedId)) {
      setError(t('map.depositGeofence.selectDepositError'));
      return;
    }
    updateDeposit.mutate(
      { id: selectedId, data: { boundary: JSON.stringify(geometry) } },
      {
        onSuccess: onClose,
        onError: () => setError(t('map.depositGeofence.saveError')),
      },
    );
  }, [selectedId, eligibleDeposits, geometry, updateDeposit, onClose, t]);

  const handleCreateNew = useCallback(() => {
    setError('');
    if (!code.trim() || !name.trim() || !address.trim()) {
      setError(t('map.depositGeofence.requiredFieldsError'));
      return;
    }
    const emailTrim = contactEmail.trim();
    createDeposit.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        address: address.trim(),
        coords: null,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        contactEmail: emailTrim ? emailTrim : null,
        boundary: JSON.stringify(geometry),
      },
      {
        onSuccess: onClose,
        onError: () => setError(t('map.depositGeofence.saveError')),
      },
    );
  }, [
    code,
    name,
    address,
    contactName,
    contactPhone,
    contactEmail,
    geometry,
    createDeposit,
    onClose,
    t,
  ]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 720px)' }}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 bg-blue-600 px-6 py-4">
          <div className="flex items-center gap-2 text-white">
            <Warehouse className="h-5 w-5 text-white/90" />
            <h2 className="text-base font-semibold">{t('map.depositGeofence.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-white/80 hover:bg-white/15 hover:text-white"
            aria-label={t('map.cancel')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b border-neutral-100 px-4 pt-3">
          <button
            type="button"
            onClick={() => {
              setTab('existing');
              setError('');
            }}
            className={`flex-1 border-b-2 py-2 text-sm font-medium transition-colors ${
              tab === 'existing'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t('map.depositGeofence.tabExisting')}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('new');
              setError('');
            }}
            className={`flex-1 border-b-2 py-2 text-sm font-medium transition-colors ${
              tab === 'new'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t('map.depositGeofence.tabNew')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'existing' ? (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                {t('map.depositGeofence.existingHint')}
              </p>
              {eligibleDeposits.length === 0 ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                  <p>{t('map.depositGeofence.noEligibleDeposits')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('new');
                      setError('');
                    }}
                    className="mt-2 text-sm font-medium text-blue-700 hover:underline"
                  >
                    {t('map.depositGeofence.switchToNewTab')}
                  </button>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    {t('map.depositGeofence.depositSelect')}
                  </label>
                  <select
                    value={selectedId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setError('');
                    }}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="">{t('map.depositGeofence.depositPlaceholder')}</option>
                    {eligibleDeposits.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-neutral-600">
                {t('map.depositGeofence.newHint')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    {t('deposits.form.code')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    {t('deposits.form.name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {t('deposits.form.address')} <span className="text-red-500">*</span>
                </label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    {t('deposits.form.contactName')}
                  </label>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    {t('deposits.form.contactPhone')}
                  </label>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {t('deposits.form.contactEmail')}
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('map.cancel')}
          </button>
          {tab === 'existing' ? (
            <button
              type="button"
              onClick={() => void handleAttachExisting()}
              disabled={isPending || eligibleDeposits.length === 0}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t('map.depositGeofence.attachButton')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreateNew()}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t('map.depositGeofence.createButton')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
