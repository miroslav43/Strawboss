'use client';

import { Calendar } from 'lucide-react';

interface ReportFiltersProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}

export function ReportFilters({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: ReportFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Calendar className="h-4 w-4 text-neutral-400" />
      <label className="text-xs text-neutral-500">From</label>
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <label className="text-xs text-neutral-500">To</label>
      <input
        type="date"
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
