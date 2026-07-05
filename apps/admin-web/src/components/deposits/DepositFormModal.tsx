'use client';

import { useState, useCallback } from 'react';
import { X, XCircle, Loader2, Check } from 'lucide-react';
import { useCreateDeliveryDestination, useUpdateDeliveryDestination } from '@strawboss/api';
import type { DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface DepositFormModalProps {
  deposit?: DeliveryDestination;
  onClose: () => void;
}

/**
 * Create / edit modal for a delivery destination (depot).
 *
 * Shared by the Deposits management page and the Map page's per-deposit
 * "edit info" action. Boundary/coords are managed separately on the map, so
 * this form only covers the textual attributes.
 */
export function DepositFormModal({ deposit, onClose }: DepositFormModalProps) {
  const { t } = useI18n();
  const isEdit = !!deposit;

  const [code, setCode] = useState(deposit?.code ?? '');
  const [name, setName] = useState(deposit?.name ?? '');
  const [address, setAddress] = useState(deposit?.address ?? '');
  const [contactName, setContactName] = useState(deposit?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(deposit?.contactPhone ?? '');
  const [contactEmail, setContactEmail] = useState(deposit?.contactEmail ?? '');
  const [isActive, setIsActive] = useState(deposit?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(deposit?.isDefault ?? false);
  const [depotType, setDepotType] = useState<'principal' | 'temporary'>(
    deposit?.depotType ?? 'principal',
  );
  const [confirmRadiusM, setConfirmRadiusM] = useState(deposit?.confirmRadiusM ?? 300);
  const [error, setError] = useState('');

  const createDeposit = useCreateDeliveryDestination(apiClient);
  const updateDeposit = useUpdateDeliveryDestination(apiClient);
  const isPending = createDeposit.isPending || updateDeposit.isPending;

  const handleSubmit = useCallback(async () => {
    if (!code.trim() || !name.trim()) {
      setError(isEdit ? t('deposits.form.updateError') : t('deposits.form.createError'));
      return;
    }
    setError('');

    const payload = {
      code: code.trim(),
      name: name.trim(),
      address: address.trim(),
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      contactEmail: contactEmail.trim() || null,
      isDefault,
      depotType,
      confirmRadiusM,
      ...(isEdit ? { isActive } : {}),
    };

    if (isEdit && deposit) {
      updateDeposit.mutate(
        { id: deposit.id, data: payload },
        {
          onSuccess: onClose,
          onError: () => setError(t('deposits.form.updateError')),
        },
      );
    } else {
      createDeposit.mutate(payload as Parameters<typeof createDeposit.mutate>[0], {
        onSuccess: onClose,
        onError: () => setError(t('deposits.form.createError')),
      });
    }
  }, [
    code,
    name,
    address,
    contactName,
    contactPhone,
    contactEmail,
    isActive,
    isDefault,
    depotType,
    confirmRadiusM,
    isEdit,
    deposit,
    createDeposit,
    updateDeposit,
    onClose,
    t,
  ]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 700px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">
            {isEdit ? t('deposits.form.editTitle') : t('deposits.form.createTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Code + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.code')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('deposits.form.codePlaceholder')}
                autoFocus
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('deposits.form.namePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('deposits.form.address')}
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('deposits.form.addressPlaceholder')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Contact Name + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.contactName')}
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder={t('deposits.form.contactNamePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.contactPhone')}
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder={t('deposits.form.contactPhonePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Contact Email */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('deposits.form.contactEmail')}
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={t('deposits.form.contactEmailPlaceholder')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Depot type + Confirm radius */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.depotType')}
              </label>
              <select
                value={depotType}
                onChange={(e) => setDepotType(e.target.value as 'principal' | 'temporary')}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="principal">{t('deposits.form.depotTypePrincipal')}</option>
                <option value="temporary">{t('deposits.form.depotTypeTemporary')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('deposits.form.confirmRadiusM')}
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={confirmRadiusM}
                onChange={(e) =>
                  setConfirmRadiusM(Math.max(1, Math.round(Number(e.target.value) || 1)))
                }
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-neutral-400">
                {t('deposits.form.confirmRadiusHint')}
              </p>
            </div>
          </div>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
              <span className="text-sm font-medium text-neutral-700">
                {t('deposits.form.activeDeposit')}
              </span>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? 'bg-primary' : 'bg-neutral-300'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          )}

          {/* Default deposit toggle */}
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
            <span className="text-sm font-medium text-neutral-700 pr-3">
              {t('deposits.form.defaultDeposit')}
            </span>
            <button
              type="button"
              onClick={() => setIsDefault((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${isDefault ? 'bg-primary' : 'bg-neutral-300'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isDefault ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('deposits.cancel')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isEdit ? t('deposits.save') : t('deposits.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
