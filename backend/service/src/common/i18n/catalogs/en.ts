/**
 * Server-generated English strings — push notifications today; email/SMS/PDF
 * labels land in later phases (see the `push`-only scope note below).
 *
 * This is the SHAPE SOURCE for the other two catalogs: `ro.ts` and `hu.ts`
 * each import `CatalogShape<typeof en>` (defined locally in each file, same
 * as `apps/mobile/src/i18n/en.ts`) so a missing or extra key is a compile
 * error, not a silent runtime fallback. See that file's comment for why a
 * direct `satisfies typeof en` doesn't work (this catalog's `as const` types
 * every leaf as its own string literal, so a differently-worded translation
 * would fail the exact same way a missing key should).
 *
 * Scope: Task 6.2 covers only `push` (the notifications funnel). `email`,
 * `sms`, `pdf` land in Task 6.3/6.4 — do not add empty stubs for them here,
 * that decision belongs to whoever designs those namespaces.
 */
export const en = {
  push: {
    /**
     * Locale-correct fallback words substituted into a push body when the
     * live value (parcel name, crop, plate...) is missing. Kept as catalog
     * entries — not per-file literals — because the fallback text is just as
     * much a translation concern as the surrounding sentence: interpolating
     * a Romanian word into an English/Hungarian push would be exactly the
     * "bală in the push, something else in the app" failure this catalog
     * exists to prevent.
     */
    common: {
      genericField: 'field',
      unknownCrop: 'unknown crop',
      newParcel: 'new field',
      aParcel: 'a field',
      destination: 'destination',
      aTruck: 'a truck',
      aTruckCapitalized: 'A truck',
      yourField: 'your field',
    },
    /** sendFieldEntryConfirm(action: 'truck') — geofence entry, truck at source field. */
    fieldEntryConfirmTruck: {
      title: 'Have you arrived at the field?',
      body: 'Field {code}. Auto-confirms in 10 s.',
    },
    /** sendFieldEntryConfirm(action: 'load') — geofence entry, loader at source field. */
    fieldEntryConfirmLoad: {
      title: 'Start loading?',
      body: 'Field {code}. Auto-confirms in 10 s.',
    },
    loaderFieldExitConfirm: {
      title: 'Have you finished loading?',
      body: 'You left {parcelName}. Did you load all the bales?',
    },
    balerFieldEntryConfirm: {
      title: 'Start baling?',
      body: 'Field {code} — {cropLabel}. Auto-confirms in 10 s.',
    },
    balerFieldExitProduction: {
      title: 'You left the field',
      body: 'Enter the bale count for {code}.',
    },
    truckUnloadedLoaderPrompt: {
      title: 'Truck unloaded',
      body: 'Truck {truckCode} has finished unloading. Do you want to call it back?',
    },
    /** sendTruckIdleAdminAlert(reason: 'loader_declined') */
    truckIdleLoaderDeclined: {
      title: 'Truck released',
      body: 'The loader declined the recall — truck {truckCode} is free.',
    },
    /** sendTruckIdleAdminAlert(reason: 'idle_timeout', the default) */
    truckIdleTimeout: {
      title: 'Truck idle',
      body: 'Truck {truckCode} has been idle for {idleMinutes} min.',
    },
    parcelLoadMismatch: {
      title: 'Field not fully loaded',
      body: '{label}: missing {missing} bales (produced {produced}, loaded {loaded}).',
    },
    /** geofence.service.ts — truck enters the deposit/depot geofence. */
    depositEntry: {
      title: 'You have arrived at the depot',
      body: 'Confirm your arrival to close the trip.',
    },
    /** geofence.service.ts — truck exits the source parcel, DEPART is available. */
    departPrompt: {
      title: 'Have you left the field?',
      body: 'Confirm your departure to start the trip to the depot.',
    },
    truckArrivedAtLoader: {
      title: 'A truck has arrived',
      body: 'Truck {plate} has arrived at {where}.',
    },
    depotTruckArrived: {
      title: 'Truck arrived at the depot',
      body: 'Truck {plate} has arrived. Confirm the bales to unload.',
    },
    depotTruckApproaching: {
      title: 'Truck approaching',
      body: 'Truck {plate} is approaching the depot (~{km} km).',
    },
    truckApproachingLoader: {
      title: 'Truck approaching',
      body: 'Truck {plate} — the driver is approaching you.',
    },
    /** task-assignments.service.ts — new task assigned to a user. */
    assignmentCreated: {
      title: 'New task',
      body: 'You have a task on field {parcelName}',
    },
    /** trips.service.ts pushToDriver — START_LOADING transition. */
    startLoading: {
      title: 'Loading has started',
      body: 'The loader has started loading the truck.',
    },
    /** trips.service.ts pushToDriver — COMPLETE_LOADING transition and the loader "truck full" flow. */
    tripLoaded: {
      title: 'Truck ready',
      body: 'The bales have been loaded. You can leave.',
    },
    /** trips.service.ts pushToDriver — DEPART transition. */
    tripDeparted: {
      title: 'Safe travels',
      body: 'The trip is on its way to {destination}.',
    },
    /** trips.service.ts pushToDriver — ARRIVE transition. */
    tripArrived: {
      title: 'You have arrived',
      body: 'Confirm delivery when you are ready.',
    },
    /** trips.service.ts pushToDriver — COMPLETE transition. */
    tripCompleted: {
      title: 'Trip completed',
      body: 'The trip has been completed successfully.',
    },
    /** trips.service.ts pushToDriver — depot operator started unloading. */
    depotUnloadStarted: {
      title: 'Unloading',
      body: 'The depot operator has started unloading.',
    },
    /** trips.service.ts pushToDriver — depot operator confirmed the bales. */
    depotConfirmed: {
      title: 'Delivery confirmed at the depot',
      body: 'The depot has confirmed the bales. The trip is complete.',
    },
    /** trips.service.ts pushToDriver — loader recalls the driver for another iteration. */
    tripNextIteration: {
      title: 'New trip',
      body: 'The loader is calling you back — trip {iterationIndex}.',
    },
    /** trips.service.ts pushToDriver — DISPUTE transition. */
    tripDisputed: {
      title: 'Trip disputed',
      body: 'Your trip has entered dispute. Contact dispatch.',
    },
  },
} as const;
