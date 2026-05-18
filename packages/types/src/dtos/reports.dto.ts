/** Detailed admin reports — production per farm/field, depot stock, timeline. */

/** Production for a single field (parcel) within a farm. */
export interface FieldReport {
  parcelId: string;
  parcelName: string;
  parcelCode: string;
  produced: number;
  loaded: number;
  delivered: number;
  lossPercentage: number;
}

/** Production aggregated per farm, with a breakdown of its fields. */
export interface FarmReport {
  /** `null` for the synthetic "no farm" bucket. */
  farmId: string | null;
  farmName: string;
  fieldCount: number;
  produced: number;
  loaded: number;
  delivered: number;
  lossPercentage: number;
  fields: FieldReport[];
}

/** Stock and movement for a delivery destination (depot). */
export interface DepotReport {
  depotId: string;
  depotName: string;
  depotCode: string;
  /** Cumulative bales ever delivered to this depot (all-time). */
  totalStock: number;
  /** Bales delivered within the selected date range. */
  receivedInPeriod: number;
  /** Bales currently in transit toward this depot (status arrived/delivering). */
  arrivingNow: number;
  /** Number of delivered/completed trips to this depot (all-time). */
  deliveryCount: number;
}

/** One day in the loaded-vs-delivered timeline series. */
export interface ReportTimelinePoint {
  date: string;
  produced: number;
  loaded: number;
  delivered: number;
}
