'use client';
import { X, Pencil } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { BeneficiaryContact } from '@strawboss/types';

export function SelectedContactsChips({
  contacts,
  onRemove,
  onEdit,
}: {
  contacts: BeneficiaryContact[];
  onRemove: (id: string) => void;
  onEdit: (c: BeneficiaryContact) => void;
}) {
  const { t } = useI18n();
  if (contacts.length === 0) return null;
  return (
    <ul className="mb-3 space-y-2">
      {contacts.map((c, i) => (
        <li
          key={c.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-bark">
              {c.name}
              {i === 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {t('beneficiaryPortal.saved.primaryBadge')}
                </span>
              )}
            </p>
            <p className="truncate text-xs text-stone-500">
              {[c.phone, c.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(c)}
              className="rounded-md p-1.5 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('beneficiaryPortal.saved.removeContact')}
              onClick={() => onRemove(c.id)}
              className="rounded-md p-1.5 text-stone-400 hover:bg-rose-100 hover:text-rose-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
