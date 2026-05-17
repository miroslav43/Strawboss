/**
 * Shared push payloads for test / QA simulators (dev + admin notifications).
 * Keep in sync with mobile {@link handleIncomingPush} `data.type` values.
 */
export type SimulatePushEvent =
  | 'field_entry'
  | 'deposit_entry'
  | 'truck_arrived_at_loader'
  | 'trip_loaded'
  | 'trip_departed'
  | 'trip_arrived'
  | 'trip_completed'
  | 'trip_disputed'
  | 'broadcast';

interface EventTemplate {
  title: (vars: Record<string, string>) => string;
  body: (vars: Record<string, string>) => string;
}

const EVENT_TEMPLATES: Record<SimulatePushEvent, EventTemplate> = {
  field_entry: {
    title: () => 'Ai intrat pe câmp',
    body: (v) => `Ai ajuns la ${v.parcel ?? 'câmpul asignat'}.`,
  },
  deposit_entry: {
    title: () => 'Ai ajuns la depozit',
    body: () => 'Ești în zona de livrare.',
  },
  truck_arrived_at_loader: {
    title: () => 'A sosit un camion',
    body: (v) => `Camionul ${v.plate ?? 'demo'} a ajuns la ${v.parcel ?? 'câmpul tău'}.`,
  },
  trip_loaded: {
    title: () => 'Transport pregătit',
    body: () => 'Baloții au fost încărcați. Poți pleca.',
  },
  trip_departed: {
    title: () => 'Drum bun',
    body: (v) => `Cursa este în drum spre ${v.warehouse ?? 'destinație'}.`,
  },
  trip_arrived: {
    title: () => 'Ai ajuns la destinație',
    body: () => 'Confirmă livrarea când ești gata.',
  },
  trip_completed: {
    title: () => 'Transport finalizat',
    body: () => 'Transportul a fost completat cu succes.',
  },
  trip_disputed: {
    title: () => 'Dispută transport',
    body: () => 'Transportul tău a intrat în dispută. Contactează dispeceratul.',
  },
  broadcast: {
    title: (v) => v.title ?? 'Anunț',
    body: (v) => v.body ?? 'Mesaj de la dispecerat.',
  },
};

export const SIMULATE_PUSH_EVENTS = Object.keys(EVENT_TEMPLATES) as SimulatePushEvent[];

export function isSimulatePushEvent(e: string): e is SimulatePushEvent {
  return e in EVENT_TEMPLATES;
}

export function buildSimulatedPush(
  event: SimulatePushEvent,
  vars: Record<string, string> = {},
  options: { markSimulated?: boolean } = {},
): { title: string; body: string; data: Record<string, unknown> } {
  const template = EVENT_TEMPLATES[event];
  const title = template.title(vars);
  const body = template.body(vars);
  const data: Record<string, unknown> = { type: event, ...vars };
  if (options.markSimulated !== false) {
    data.simulated = 'true';
  }
  return { title, body, data };
}
