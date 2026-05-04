'use client';

import { useMemo, useState } from 'react';
import { apiClient } from '@/lib/api';

interface UserAvatarProps {
  user: { fullName: string; avatarUrl?: string | null };
  size?: 'sm' | 'md' | 'lg';
  /** Optional colored ring (used on the admin accounts list to hint at role). */
  ringClassName?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-12 w-12 text-sm',
  lg: 'h-24 w-24 text-2xl',
};

/**
 * Renders a user's profile picture as a circle. Falls back to a two-letter
 * initials tile when no `avatarUrl` is present or the image fails to load.
 *
 * Colors come from a deterministic hash of the full name so each user gets the
 * same colored tile across the app without us persisting a color per row.
 */
export function UserAvatar({ user, size = 'sm', ringClassName }: UserAvatarProps) {
  const [errored, setErrored] = useState(false);
  const resolvedUrl = apiClient.resolveAssetUrl(user.avatarUrl ?? null);

  const initials = useMemo(() => {
    const parts = user.fullName.trim().split(/\s+/).slice(0, 2);
    const letters = parts.map((p) => p.charAt(0).toUpperCase()).join('');
    return letters || '?';
  }, [user.fullName]);

  const bgClass = useMemo(() => hashColorClass(user.fullName), [user.fullName]);

  const dim = SIZE_CLASSES[size];
  const ring = ringClassName ?? '';

  if (resolvedUrl && !errored) {
    return (
      <img
        src={resolvedUrl}
        alt={user.fullName}
        className={`${dim} ${ring} shrink-0 rounded-full border border-neutral-200 object-cover`}
        loading="lazy"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <span
      aria-label={user.fullName}
      className={`${dim} ${ring} ${bgClass} shrink-0 inline-flex items-center justify-center rounded-full font-semibold text-white`}
    >
      {initials}
    </span>
  );
}

// Tailwind class names must be literals for the JIT scanner to pick them up,
// so we use a fixed palette and hash into its indices rather than building the
// class string dynamically.
const PALETTE = [
  'bg-amber-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-purple-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
] as const;

function hashColorClass(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
