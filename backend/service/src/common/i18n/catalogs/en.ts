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
  /**
   * Operator-facing HTTP error text (Task 6.4). Scoped deliberately: this is
   * NOT a translation of all ~339 thrown messages in the backend, only the
   * handful that reach an authenticated operator's screen or a mobile sync
   * failure banner — the global exception-filter fallback, the Zod
   * validation-pipe fallback, and the season-closed write gate. See
   * task-6.4-report.md for the full criterion and the messages deliberately
   * left untranslated (admin-only actions, internal 500s, the other ~317).
   */
  errors: {
    /** zod-validation.pipe.ts fallback — the pipe never sees the caller's
     *  locale (see that file's header comment), so it throws this key and
     *  AllExceptionsFilter resolves the text. The raw per-field Zod detail
     *  (English) is carried separately in `fieldErrors`/`formErrors`, never
     *  mixed into this message. */
    invalidData: 'Invalid data.',
    /** all-exceptions.filter.ts's own fallback — the only HTTP-error
     *  chokepoint in the app; every client in every language passes through
     *  it whenever a 4xx exception carries no other message. */
    invalidRequest: 'Invalid request.',
    /** seasons.service.ts assertSeasonWritable — the write-time gate mobile's
     *  sync/push.ts classifies as a terminal rejection and can surface
     *  verbatim to the operator. */
    seasonClosed: 'Season {year} is closed. This entry can no longer be saved.',
    /** auth.guard.ts — the JWT verifies but the user row is gone/soft-deleted. */
    accountNotFound: 'Account does not exist or was deleted',
    /** auth.guard.ts — the JWT verifies but the account was deactivated. */
    accountInactive: 'Account inactive',
  },
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
  /**
   * PDF document labels (Task 6.3). Unlike `push` above, these are flat
   * key/value UI labels with no interpolation — a natural fit for the
   * catalog, unlike the email/SMS bodies in messaging/message-templates.ts
   * (see that file's header comment for why those stayed file-local).
   */
  pdf: {
    /** documents/cmr/templates/cmr.hbs, rendered via cmr.service.ts. */
    cmr: {
      title: 'CMR CONSIGNMENT NOTE',
      tripNoLabel: 'Trip no.:',
      sectionSender: '1. SENDER',
      parcel: 'Field',
      address: 'Address',
      sectionRecipient: '2. RECIPIENT',
      depotName: 'Depot name',
      sectionCarrier: '3. CARRIER',
      truck: 'Truck',
      driver: 'Driver',
      sectionGoods: '4. GOODS TRANSPORTED',
      baleCount: 'Bale count',
      loadCount: 'Load count',
      grossWeight: 'Gross weight (kg)',
      tareWeight: 'Truck tare (kg)',
      netWeight: 'Net weight (kg)',
      weightTicket: 'Weigh ticket no.',
      sectionTripDetails: '5. TRIP DETAILS',
      departure: 'Departure',
      arrival: 'Arrival',
      deliveryConfirmed: 'Delivery confirmed',
      distance: 'Distance travelled (km)',
      sectionObservations: '6. REMARKS',
      sectionSignatures: 'SIGNATURES',
      senderOperatorSignature: 'SENDER / OPERATOR',
      operatorSignatureAlt: "Operator's signature",
      driverCarrierSignature: 'DRIVER / CARRIER',
      driverSignatureAlt: "Driver's signature",
      receiver: 'RECEIVER',
      receiverSignatureAlt: "Receiver's signature",
      footerGenerated: 'Document automatically generated by',
      footerTrip: 'Trip',
    },
    /**
     * documents/comanda/templates/comanda.hbs, rendered via comanda.service.ts.
     * Covers the form labels only — the ".clauses" legal paragraphs (Romanian
     * transport-contract law, incl. the BNR exchange-rate clause and the CMR
     * insurance request) are deliberately NOT in this catalog. See the HTML
     * comment above `.clauses` in the template for why.
     */
    comanda: {
      docTitleWord: 'Order',
      orderHeading: 'ORDER',
      to: 'To:',
      attentionOf: 'Attn.',
      intro:
        'Following our phone conversation, we are placing a firm order for a truck for a transport with the following details:',
      goodsLabel: 'Description of goods:',
      truckNoLabel: 'Vehicle no.:',
      driverLabel: 'Driver:',
      loadingLabel: 'Loading:',
      unloadingLabel: 'Unloading:',
      valueLabel: 'Transport value:',
      paymentPrefix: 'Payment method: bank transfer within ',
      paymentSuffix: ' days of receiving the original documents',
      obsLabel: 'Remarks:',
      otherClauses: 'OTHER CLAUSES:',
      confirmation: 'CONFIRMATION,',
      transporterWord: 'CARRIER',
    },
  },
} as const;
