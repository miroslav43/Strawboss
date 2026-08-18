import { normalizeLocale, type Locale } from '@strawboss/types';

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

/**
 * One `EventTemplate` set per locale. `Record<SimulatePushEvent, EventTemplate>`
 * already gives full compile-time key parity here — unlike the `push.*`
 * catalog in `common/i18n/catalogs/`, these leaves are FUNCTIONS, not `as
 * const` string literals, so there is no literal-narrowing trap to guard
 * against with `CatalogShape`: a plain `Record<union, T>` type annotation on
 * an object literal already requires every union member and rejects extras
 * (excess-property checking). Deleting an event from `hu` below fails the
 * same way as deleting a `push.*` key from `catalogs/hu.ts` — see
 * task-6.2-report.md for both proofs.
 *
 * `ro` is unchanged from before this file had a locale dimension — same
 * literals, same fallback defaults, not a rewrite.
 */
const ro: Record<SimulatePushEvent, EventTemplate> = {
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

const en: Record<SimulatePushEvent, EventTemplate> = {
  field_entry: {
    title: () => 'You entered the field',
    body: (v) => `You have arrived at ${v.parcel ?? 'the assigned field'}.`,
  },
  deposit_entry: {
    title: () => 'You have arrived at the depot',
    body: () => 'You are in the delivery zone.',
  },
  truck_arrived_at_loader: {
    title: () => 'A truck has arrived',
    body: (v) => `Truck ${v.plate ?? 'demo'} has arrived at ${v.parcel ?? 'your field'}.`,
  },
  trip_loaded: {
    title: () => 'Truck ready',
    body: () => 'The bales have been loaded. You can leave.',
  },
  trip_departed: {
    title: () => 'Safe travels',
    body: (v) => `The trip is on its way to ${v.warehouse ?? 'the destination'}.`,
  },
  trip_arrived: {
    title: () => 'You have arrived',
    body: () => 'Confirm delivery when you are ready.',
  },
  trip_completed: {
    title: () => 'Trip completed',
    body: () => 'The trip has been completed successfully.',
  },
  trip_disputed: {
    title: () => 'Trip disputed',
    body: () => 'Your trip has entered dispute. Contact dispatch.',
  },
  broadcast: {
    title: (v) => v.title ?? 'Announcement',
    body: (v) => v.body ?? 'Message from dispatch.',
  },
};

const hu: Record<SimulatePushEvent, EventTemplate> = {
  field_entry: {
    title: () => 'Belépett a táblára',
    body: (v) => `Megérkezett ide: ${v.parcel ?? 'a kijelölt tábla'}.`,
  },
  deposit_entry: {
    title: () => 'Megérkezett a raktárhoz',
    body: () => 'A szállítási zónában tartózkodik.',
  },
  truck_arrived_at_loader: {
    title: () => 'Megérkezett egy kamion',
    body: (v) =>
      `A(z) ${v.plate ?? 'demo'} kamion megérkezett ide: ${v.parcel ?? 'az Ön táblája'}.`,
  },
  trip_loaded: {
    title: () => 'A kamion megrakva',
    body: () => 'A bálák felrakodásra kerültek. Elindulhat.',
  },
  trip_departed: {
    title: () => 'Jó utat',
    body: (v) => `A fuvar úton van a(z) ${v.warehouse ?? 'úticél'} felé.`,
  },
  trip_arrived: {
    title: () => 'Megérkezett a célállomásra',
    body: () => 'Erősítse meg a leszállítást, amikor készen áll.',
  },
  trip_completed: {
    title: () => 'Fuvar lezárva',
    body: () => 'A fuvar sikeresen lezárult.',
  },
  trip_disputed: {
    title: () => 'Vitatott fuvar',
    body: () => 'A fuvarja vitatottá vált. Vegye fel a kapcsolatot a diszpécserrel.',
  },
  broadcast: {
    title: (v) => v.title ?? 'Közlemény',
    body: (v) => v.body ?? 'Üzenet a diszpécsertől.',
  },
};

const TEMPLATES_BY_LOCALE: Record<Locale, Record<SimulatePushEvent, EventTemplate>> = {
  ro,
  en,
  hu,
};

export const SIMULATE_PUSH_EVENTS = Object.keys(ro) as SimulatePushEvent[];

export function isSimulatePushEvent(e: string): e is SimulatePushEvent {
  return e in ro;
}

export function buildSimulatedPush(
  event: SimulatePushEvent,
  locale: string | null | undefined,
  vars: Record<string, string> = {},
  options: { markSimulated?: boolean } = {},
): { title: string; body: string; data: Record<string, unknown> } {
  const template = TEMPLATES_BY_LOCALE[normalizeLocale(locale)][event];
  const title = template.title(vars);
  const body = template.body(vars);
  const data: Record<string, unknown> = { type: event, ...vars };
  if (options.markSimulated !== false) {
    data.simulated = 'true';
  }
  return { title, body, data };
}
