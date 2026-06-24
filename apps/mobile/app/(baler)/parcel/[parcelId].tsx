/**
 * T5 — Baler parcel detail screen.
 *
 * Reached from the baler home when the operator taps a task card with an
 * attached `parcelId`. Renders the shared `ParcelDetailView` with the baler's
 * own primary action ("Înregistrează producție") and map tab.
 */

import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ParcelDetailView } from '@/components/features/parcel/ParcelDetailView';
import { useI18n } from '@/lib/i18n';

export default function BalerParcelDetailScreen() {
  const { t } = useI18n();
  const { parcelId } = useLocalSearchParams<{ parcelId: string }>();

  const handleOpenMap = useCallback(() => {
    router.push(`/(baler)/map?focusId=${parcelId ?? ''}`);
  }, [parcelId]);

  const handleGoToProduction = useCallback(() => {
    router.push(`/(baler)/production`);
  }, []);

  return (
    <ParcelDetailView
      parcelId={parcelId ?? ''}
      onOpenMap={handleOpenMap}
      primaryAction={{
        label: t('baler.parcelDetail.primaryActionLabel'),
        onPress: handleGoToProduction,
      }}
    />
  );
}
