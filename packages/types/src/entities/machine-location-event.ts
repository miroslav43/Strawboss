export interface MachineLocationEvent {
  id: string;
  machineId: string | null;
  operatorId: string | null;
  lat: number;
  lon: number;
  /** GeoJSON Point serialized as a string from PostGIS ST_AsGeoJSON */
  coords: string | null;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMs: number | null;
  recordedAt: string;
  createdAt: string;
}

/** Last known position of a machine, returned by GET /api/v1/location/machines */
export interface MachineLastLocation {
  machineId: string;
  /** Value from the machine_type enum: 'baler' | 'loader' | 'truck' */
  machineType: string | null;
  /** COALESCE(internal_code, registration_plate) */
  machineCode: string | null;
  operatorId: string | null;
  /** users.full_name of the operator (last GPS reporter) */
  operatorName: string | null;
  /** users.id where users.assigned_machine_id = this machine */
  assignedUserId: string | null;
  /** users.full_name of the permanently assigned user */
  assignedUserName: string | null;
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMs: number | null;
  recordedAt: string;
}
