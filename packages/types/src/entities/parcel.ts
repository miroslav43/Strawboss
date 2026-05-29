import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';

/** @deprecated T9.2 — kept for one release for older clients. Do not surface in UI. */
export enum ParcelStatus {
  active = 'active',
  inactive = 'inactive',
}

/** Crop type for the parcel — T9.1. Nullable on storage; UI must handle null. */
export enum CropType {
  grau = 'grau',
  orz = 'orz',
  rapita = 'rapita',
  plante_nutret = 'plante_nutret',
}

/**
 * Field harvest / work phase.
 * Extended ladder (T9.10): planned → to_harvest → harvesting →
 *   (partial_harvested) → harvested → in_loading → loaded → completed.
 * Server enforces monotonic transitions via trg_prevent_harvest_status_downgrade (migration 00042).
 */
export enum HarvestStatus {
  planned = 'planned',
  to_harvest = 'to_harvest',
  harvesting = 'harvesting',
  partial_harvested = 'partial_harvested',
  harvested = 'harvested',
  in_loading = 'in_loading',
  loaded = 'loaded',
  completed = 'completed',
}

/** Integer rank mirroring the SQL harvest_status_rank() function. */
export const HARVEST_STATUS_RANK: Record<HarvestStatus, number> = {
  [HarvestStatus.planned]: 0,
  [HarvestStatus.to_harvest]: 1,
  [HarvestStatus.harvesting]: 2,
  [HarvestStatus.partial_harvested]: 3,
  [HarvestStatus.harvested]: 4,
  [HarvestStatus.in_loading]: 5,
  [HarvestStatus.loaded]: 6,
  [HarvestStatus.completed]: 7,
};

/**
 * One parcel inside a bulk KML import request. `code` is the stable identifier
 * (e.g. the APIA block-parcel name from the KML) used for upsert-by-conflict.
 * `boundary` is a stringified GeoJSON Polygon/MultiPolygon.
 */
export interface ParcelImportInput {
  code: string;
  name?: string;
  boundary: string;
  /** Declared area (hectares). When omitted the server computes it from boundary. */
  areaHectares?: number;
  notes?: string | null;
}

/** Payload for `POST /api/v1/parcels/import`. */
export interface ParcelImportRequest {
  /** Farm every imported parcel is assigned to. Null/omitted ⇒ unassigned. */
  farmId?: string | null;
  parcels: ParcelImportInput[];
}

/** Result summary returned by the bulk KML import endpoint. */
export interface ParcelImportResult {
  total: number;
  created: number;
  updated: number;
  /** Conflicting rows that were soft-deleted and therefore left untouched. */
  skipped: number;
  failed: number;
  errors: { code: string; message: string }[];
}

export interface Parcel extends Timestamps, SoftDelete {
  id: string;
  code: string;
  /** @deprecated T9.3 — kept in DB and on the wire; UI shows `code` instead. */
  name: string;
  areaHectares: number;
  boundary: string | null;
  centroid: GeoPoint | null;
  address: string;
  municipality: string;
  farmtrackGeofenceId: string | null;
  farmId: string | null;
  notes: string | null;
  /** @deprecated T9.2 — server still returns true; not surfaced in UI. */
  isActive: boolean;
  harvestStatus: HarvestStatus;
  /** T9.1 — null until admin sets it. */
  cropType: CropType | null;
}
