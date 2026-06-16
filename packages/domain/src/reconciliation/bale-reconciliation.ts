export interface BaleReconciliationInput {
  parcelId: string;
  produced: number;
  loaded: number;
  delivered: number;
}

export interface BaleReconciliationResult {
  parcelId: string;
  produced: number;
  loaded: number;
  delivered: number;
  loadedVsProducedDiff: number;
  deliveredVsLoadedDiff: number;
  lossPercentage: number;
  hasDiscrepancy: boolean;
}

export function reconcileBales(input: BaleReconciliationInput): BaleReconciliationResult {
  const { parcelId, produced, loaded, delivered } = input;

  const loadedVsProducedDiff = loaded - produced;
  const deliveredVsLoadedDiff = delivered - loaded;

  // Loss percentage: how many bales were lost between production and delivery.
  // If produced is 0, avoid division by zero. Clamp to >= 0 so an over-count
  // (delivered > produced, a data error already surfaced via hasDiscrepancy)
  // never renders as a nonsensical negative "loss" (e.g. "Loss: -15%").
  const lossPercentage = produced > 0 ? Math.max(0, ((produced - delivered) / produced) * 100) : 0;

  // A discrepancy exists if loaded exceeds produced (impossible without error),
  // or if delivered differs from loaded (loss or miscount)
  const hasDiscrepancy = loadedVsProducedDiff !== 0 || deliveredVsLoadedDiff !== 0;

  return {
    parcelId,
    produced,
    loaded,
    delivered,
    loadedVsProducedDiff,
    deliveredVsLoadedDiff,
    lossPercentage,
    hasDiscrepancy,
  };
}
