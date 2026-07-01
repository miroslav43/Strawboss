/**
 * Outbound messaging contract for the auxiliary-truck flow.
 *
 * Email/SMS sending is intentionally left UNWIRED — the backend binds a stub
 * (StubMessagingService) that only logs. Providers (homemade or third-party)
 * plug in later behind IMessagingService without touching call sites.
 */

export enum MessageChannel {
  email = 'email',
  sms = 'sms',
}

/** The distinct moments the system emits a message in the auxiliary-truck flow. */
export enum MessageKind {
  /** A new external request arrived → notify org admins (email). */
  new_request_admin = 'new_request_admin',
  /** A request was confirmed → notify the requester (email). */
  request_confirmed_requester = 'request_confirmed_requester',
  /** Auxiliary truck assigned to a loader → notify the driver (SMS): loader phone + parcel/maps. */
  driver_assigned = 'driver_assigned',
  /** Loading complete → notify the driver (SMS) with the public sign-and-leave link. */
  driver_loaded_sign_link = 'driver_loaded_sign_link',
  /** Request confirmed → detailed email to driver + requester (pickup + delivery + route). */
  transport_confirmed = 'transport_confirmed',
  /** Request confirmed → short SMS to the driver (pickup + delivery + maps links + km). */
  transport_confirmed_driver_sms = 'transport_confirmed_driver_sms',
}

export interface OutboundMessage {
  kind: MessageKind;
  channel: MessageChannel;
  /** Email address or phone number, depending on channel. */
  to: string;
  /** Email subject; ignored for SMS. */
  subject?: string;
  body: string;
  /** Free-form context for providers/logging (tripId, requestId, slug, …). */
  metadata?: Record<string, unknown>;
}
