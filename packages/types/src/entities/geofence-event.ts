export type GeofenceType = 'parcel' | 'deposit';
export type GeofenceEventType = 'enter' | 'exit';

export interface GeofenceEvent {
  id: string;
  machineId: string;
  assignmentId: string | null;
  geofenceType: GeofenceType;
  geofenceId: string;
  eventType: GeofenceEventType;
  lat: number | null;
  lon: number | null;
  createdAt: string;
}
