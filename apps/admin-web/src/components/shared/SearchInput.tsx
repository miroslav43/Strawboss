'use client';

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Caută…',
  debounceMs = 250,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);

  // Sync external value changes
  useEffect(() => { setLocal(value); }, [value]);

  // Debounce local → parent
  useEffect(() => {
    const timer = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(timer);
  }, [local, debounceMs, onChange]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pl-8 pr-7 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {local && (
        <button
          onClick={() => { setLocal(''); onChange(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-neutral-400 hover:text-neutral-600"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
