'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Plus, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface BeneficiarySavedSelectProps<T extends { id: string }> {
  label?: string;
  placeholder: string;
  items: T[];
  selectedId: string | null;
  loading: boolean;
  error: boolean;
  getPrimary: (item: T) => string;
  getSecondary: (item: T) => string | null;
  getSearchText: (item: T) => string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
  onRetry: () => void;
}

/**
 * Searchable dropdown of saved per-beneficiary records (contacts / trucks /
 * drivers) with inline add / edit / delete. Portal palette (stone/primary).
 * Adapted from ParcelSelectDropdown with outside-click close added.
 */
export function BeneficiarySavedSelect<T extends { id: string }>({
  label,
  placeholder,
  items,
  selectedId,
  loading,
  error,
  getPrimary,
  getSecondary,
  getSearchText,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  onRetry,
}: BeneficiarySavedSelectProps<T>) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click (ParcelSelectDropdown lacks this).
  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((it) => getSearchText(it).toLowerCase().includes(q));
  }, [items, search, getSearchText]);

  const selected = items.find((it) => it.id === selectedId) ?? null;

  return (
    <div className="space-y-2" ref={wrapRef}>
      {label && (
        <span className="block text-[13px] font-medium text-stone-600">
          {label}
          <span className="ml-0.5 text-rose-500">*</span>
        </span>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={`flex w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-[15px] shadow-sm transition-colors focus:outline-none focus:ring-4 focus:ring-primary/15 ${
            selected ? 'border-primary/50 text-bark' : 'border-stone-300 text-stone-400'
          }`}
        >
          <span className="truncate">{selected ? getPrimary(selected) : placeholder}</span>
          <ChevronDown
            className={`ml-2 h-4 w-4 flex-shrink-0 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
            {/* Search */}
            <div className="border-b border-stone-100 p-2">
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('beneficiaryPortal.saved.search')}
                  className="w-full bg-transparent text-sm text-bark outline-none placeholder:text-stone-400"
                  autoFocus
                />
              </div>
            </div>

            {/* Options */}
            <div className="max-h-64 overflow-y-auto p-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-stone-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : error ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex w-full items-center justify-center gap-2 px-3 py-5 text-sm text-rose-600 hover:text-rose-700"
                >
                  <AlertCircle className="h-4 w-4" />
                  {t('beneficiaryPortal.saved.retry')}
                </button>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-5 text-center text-xs text-stone-400">
                  {items.length === 0
                    ? t('beneficiaryPortal.saved.empty')
                    : t('beneficiaryPortal.saved.noResults')}
                </p>
              ) : (
                filtered.map((it) => {
                  const secondary = getSecondary(it);
                  return (
                    <div
                      key={it.id}
                      className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                        it.id === selectedId ? 'bg-primary/10' : 'hover:bg-stone-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(it.id);
                          setIsOpen(false);
                          setSearch('');
                        }}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                      >
                        <p
                          className={`truncate text-sm font-medium ${
                            it.id === selectedId ? 'text-primary' : 'text-bark'
                          }`}
                        >
                          {getPrimary(it)}
                        </p>
                        {secondary && (
                          <p className="truncate text-xs text-stone-500">{secondary}</p>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={t('beneficiaryPortal.saved.edit')}
                        onClick={() => {
                          setIsOpen(false);
                          onEdit(it);
                        }}
                        className="rounded-md p-1.5 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('beneficiaryPortal.saved.delete')}
                        onClick={() => {
                          setIsOpen(false);
                          onDelete(it);
                        }}
                        className="rounded-md p-1.5 text-stone-400 hover:bg-rose-100 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add new */}
            <div className="border-t border-stone-100 p-2">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setSearch('');
                  onAdd();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" />
                {t('beneficiaryPortal.saved.addNew')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
