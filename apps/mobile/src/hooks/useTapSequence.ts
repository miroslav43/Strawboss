import { useCallback, useRef } from 'react';

interface UseTapSequenceOptions {
  /** How many taps before `onThreshold` fires. */
  count: number;
  /** Sliding window in milliseconds. Taps older than this are discarded. */
  windowMs: number;
  /** Called when the threshold is reached; the internal buffer resets. */
  onThreshold: () => void;
}

/**
 * Count rapid taps and fire a callback when the user hits `count` within
 * `windowMs`. Used for the easter-egg that reveals the Sincronizare card.
 *
 * Timestamps live in a ref so the component does not re-render on each tap —
 * handy when the trigger is a role-badge Pressable that otherwise renders
 * purely static text.
 */
export function useTapSequence({ count, windowMs, onThreshold }: UseTapSequenceOptions) {
  const stampsRef = useRef<number[]>([]);

  const onTap = useCallback(() => {
    const now = Date.now();
    // Drop stale taps outside the sliding window.
    const recent = stampsRef.current.filter((t) => now - t <= windowMs);
    recent.push(now);
    if (recent.length >= count) {
      stampsRef.current = [];
      onThreshold();
      return;
    }
    stampsRef.current = recent;
  }, [count, windowMs, onThreshold]);

  return { onTap };
}
