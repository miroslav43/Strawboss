import type { en } from './en';

// `en.ts` is declared `as const`, so `typeof en` types every string leaf as its
// own literal (e.g. "Truck idle"), not as `string`. Checking `ro` directly
// against `typeof en` — with either `: typeof en` or `satisfies typeof en` —
// fails on every translated string, since "Camion inactiv" is not assignable
// to the literal type "Truck idle"; it is not a key-parity check.
// `CatalogShape<T>` preserves the exact key structure of `T` but widens every
// string leaf to `string`, so the compiler enforces key parity in both
// directions — missing or extra keys become compile errors — while differing
// translated text does not. A leaf that is an array maps to `never` instead of
// recursing, so it is a compile error by construction the moment one is
// authored. Copied verbatim from apps/mobile/src/i18n/en.ts.
type CatalogShape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly unknown[]
      ? never
      : CatalogShape<T[K]>;
};

/**
 * Romanian keeps every push exactly as it read before this catalog existed —
 * these are literals moved from their emit sites (notifications.service.ts,
 * geofence.service.ts, task-assignments.service.ts, trips.service.ts), not
 * rewrites. See task-6.2-report.md for the byte-identity table.
 */
export const ro: CatalogShape<typeof en> = {
  /**
   * Task 6.4. Every entry here is the literal moved verbatim from its old
   * emit site (zod-validation.pipe.ts, all-exceptions.filter.ts,
   * seasons.service.ts, auth.guard.ts) — not a rewrite. A Romanian operator
   * (still the overwhelming majority of accounts) sees byte-identical text
   * to before this catalog existed.
   */
  errors: {
    invalidData: 'Date invalide.',
    invalidRequest: 'Cerere invalidă.',
    seasonClosed: 'Sezonul {year} este închis. Înregistrarea nu mai poate fi salvată.',
    accountNotFound: 'Cont inexistent sau șters',
    accountInactive: 'Cont inactiv',
  },
  push: {
    common: {
      genericField: 'câmp',
      unknownCrop: 'cultură necunoscută',
      newParcel: 'parcelă nouă',
      aParcel: 'o parcelă',
      destination: 'destinație',
      aTruck: 'un camion',
      aTruckCapitalized: 'Un camion',
      yourField: 'câmpul tău',
    },
    fieldEntryConfirmTruck: {
      title: 'Ai ajuns la câmp?',
      body: 'Parcela {code}. Confirmare automată în 10 s.',
    },
    fieldEntryConfirmLoad: {
      title: 'Începi încărcarea?',
      body: 'Parcela {code}. Confirmare automată în 10 s.',
    },
    loaderFieldExitConfirm: {
      title: 'Ai terminat de încărcat?',
      body: 'Ai ieșit din {parcelName}. Ai încărcat toți baloții?',
    },
    balerFieldEntryConfirm: {
      title: 'Începi balotarea?',
      body: 'Parcela {code} — {cropLabel}. Confirmare automată în 10 s.',
    },
    balerFieldExitProduction: {
      title: 'Ai ieșit din parcelă',
      body: 'Introdu numărul de baloți pentru {code}.',
    },
    truckUnloadedLoaderPrompt: {
      title: 'Camion descărcat',
      body: 'Camionul {truckCode} a descărcat. Îl chemi înapoi?',
    },
    truckIdleLoaderDeclined: {
      title: 'Camion eliberat',
      body: 'Loaderul a refuzat rechemarea — camionul {truckCode} e liber.',
    },
    truckIdleTimeout: {
      title: 'Camion inactiv',
      body: 'Camionul {truckCode} stă neutilizat de {idleMinutes} min.',
    },
    parcelLoadMismatch: {
      title: 'Câmp neîncărcat complet',
      body: '{label}: lipsă {missing} baloți (produși {produced}, încărcați {loaded}).',
    },
    depositEntry: {
      title: 'Ai ajuns la depozit',
      body: 'Confirmă sosirea ca să închei cursa.',
    },
    departPrompt: {
      title: 'Ai plecat de la câmp?',
      body: 'Confirmă plecarea ca să pornești cursa spre depozit.',
    },
    truckArrivedAtLoader: {
      title: 'A sosit un camion',
      body: 'Camionul {plate} a ajuns la {where}.',
    },
    depotTruckArrived: {
      title: 'Camion sosit la depozit',
      body: 'Camionul {plate} a sosit. Confirmă baloții pentru a descărca.',
    },
    depotTruckApproaching: {
      title: 'Camion în apropiere',
      body: 'Camionul {plate} se apropie de depozit (~{km} km).',
    },
    truckApproachingLoader: {
      title: 'Camion în apropiere',
      body: 'Camionul {plate} — șoferul se apropie spre tine.',
    },
    assignmentCreated: {
      title: 'Sarcină nouă',
      body: 'Ai o sarcină pe parcela {parcelName}',
    },
    startLoading: {
      title: 'Începe încărcarea',
      body: 'Loaderul a început încărcarea camionului.',
    },
    tripLoaded: {
      title: 'Transport pregătit',
      body: 'Baloții au fost încărcați. Poți pleca.',
    },
    tripDeparted: {
      title: 'Drum bun',
      body: 'Cursa este în drum spre {destination}.',
    },
    tripArrived: {
      title: 'Ai ajuns la destinație',
      body: 'Confirmă livrarea când ești gata.',
    },
    tripCompleted: {
      title: 'Transport finalizat',
      body: 'Transportul a fost completat cu succes.',
    },
    depotUnloadStarted: {
      title: 'Se descarcă',
      body: 'Operatorul depozitului a început descărcarea.',
    },
    depotConfirmed: {
      title: 'Livrare confirmată la depozit',
      body: 'Depozitul a confirmat baloții. Cursa este finalizată.',
    },
    tripNextIteration: {
      title: 'Cursă nouă',
      body: 'Loaderul te cheamă înapoi — cursa {iterationIndex}.',
    },
    tripDisputed: {
      title: 'Dispută transport',
      body: 'Transportul tău a intrat în dispută. Contactează dispeceratul.',
    },
  },
  /**
   * PDF document labels (Task 6.3). These are literals moved verbatim from
   * documents/cmr/templates/cmr.hbs and documents/comanda/templates/comanda.hbs
   * — not rewrites. See task-6.3-report.md for the byte-identity table.
   */
  pdf: {
    cmr: {
      title: 'SCRISOARE DE TRANSPORT CMR',
      tripNoLabel: 'Nr. cursă:',
      sectionSender: '1. EXPEDITOR',
      parcel: 'Parcelă',
      address: 'Adresă',
      sectionRecipient: '2. DESTINATAR',
      depotName: 'Nume depozit',
      sectionCarrier: '3. TRANSPORTATOR',
      truck: 'Camion',
      driver: 'Șofer',
      sectionGoods: '4. MARFA TRANSPORTATĂ',
      baleCount: 'Nr. baloți',
      loadCount: 'Nr. încărcări',
      grossWeight: 'Greutate brută (kg)',
      tareWeight: 'Tară camion (kg)',
      netWeight: 'Greutate netă (kg)',
      weightTicket: 'Nr. tichet cântar',
      sectionTripDetails: '5. DETALII CURSĂ',
      departure: 'Plecare',
      arrival: 'Sosire',
      deliveryConfirmed: 'Livrare confirmată',
      distance: 'Distanță parcursă (km)',
      sectionObservations: '6. OBSERVAȚII',
      sectionSignatures: 'SEMNĂTURI',
      senderOperatorSignature: 'EXPEDITOR / OPERATOR',
      operatorSignatureAlt: 'Semnătura operatorului',
      driverCarrierSignature: 'ȘOFER / TRANSPORTATOR',
      driverSignatureAlt: 'Semnătura șoferului',
      receiver: 'PRIMITOR',
      receiverSignatureAlt: 'Semnătura primitorului',
      footerGenerated: 'Document generat automat de',
      footerTrip: 'Cursă',
    },
    comanda: {
      docTitleWord: 'Comandă',
      orderHeading: 'COMANDA',
      to: 'Către:',
      attentionOf: 'În atenția',
      // Embedded newline + 4-space indent matches the original comanda.hbs
      // source's line-wrap exactly (byte-identical rendered text — the
      // `.intro` block never set `white-space: pre`, so this was already
      // whitespace-collapsed to one space on screen; keeping the literal
      // source bytes here just removes any need to reason about that).
      intro:
        'În urma discuției telefonice avute cu dumneavoastră, vă comandam ferm un\n    autocamion pentru un transport cu urmatoarele date:',
      goodsLabel: 'Denumirea marfii:',
      truckNoLabel: 'Nr. auto:',
      driverLabel: 'Șofer:',
      loadingLabel: 'Încarcare:',
      unloadingLabel: 'Descarcare:',
      valueLabel: 'Valoare transport:',
      paymentPrefix: 'Modalitatea de plată: OP la ',
      paymentSuffix: ' de zile de la primirea actelor în original',
      obsLabel: 'OBS:',
      otherClauses: 'ALTE CLAUZE:',
      confirmation: 'CONFIRMARE,',
      transporterWord: 'TRANSPORTATOR',
    },
  },
};
