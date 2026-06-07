/**
 * Loader parcel detail screen.
 *
 * Reached from the loader home when the operator taps an assigned field — the
 * active "Teren activ" banner or a candidate row. Renders the shared
 * `ParcelDetailView` without a production CTA (loaders don't produce bales);
 * the bale count and "Navighează până acolo" / "Deschide pe hartă" actions come
 * from the shared view.
 */

import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ParcelDetailView } from '@/components/features/parcel/ParcelDetailView';

export default function LoaderParcelDetailScreen() {
  const { parcelId } = useLocalSearchParams<{ parcelId: string }>();

  const handleOpenMap = useCallback(() => {
    router.push(`/(loader)/map?focusId=${parcelId ?? ''}`);
  }, [parcelId]);

  return <ParcelDetailView parcelId={parcelId ?? ''} onOpenMap={handleOpenMap} />;
}
