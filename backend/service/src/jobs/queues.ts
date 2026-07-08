export const QUEUE_ALERT_EVALUATION = 'alert-evaluation';
export const QUEUE_RECONCILIATION = 'reconciliation';
export const QUEUE_CMR_GENERATION = 'cmr-generation';
export const QUEUE_SYNC_CLEANUP = 'sync-cleanup';
export const QUEUE_GEOFENCE_CHECK = 'geofence-check';
// Plan C — periodic scan for trucks idle past the threshold (default 30 min).
export const QUEUE_TRUCK_IDLE_CHECK = 'truck-idle-check';
// Fleet OTA — delayed job that activates a scheduled deployment.
export const QUEUE_OTA_DEPLOY = 'ota-deploy';
// Daily PIN regeneration for beneficiary records (02:00 Europe/Bucharest).
export const QUEUE_PIN_REGEN = 'pin-regen';
// Outbound message send (transport-confirmation email + driver SMS enqueue).
export const QUEUE_MESSAGE_SEND = 'message-send';
// Auxiliary trips — delayed job that auto-completes an aux trip a few minutes
// after it is loaded (planned → loaded → completed).
export const QUEUE_TRIP_AUTOCOMPLETE = 'trip-autocomplete';
// Presence dead-man — periodic scan that FCM-wakes device-owner phones whose
// last check-in has gone stale (external safety net for the always-on anchor).
export const QUEUE_PRESENCE_DEADMAN = 'presence-deadman';
