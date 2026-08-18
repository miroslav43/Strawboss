import type { en } from './en';

// See ro.ts for why this needs CatalogShape rather than `: typeof en` /
// `satisfies typeof en` directly (as const literal-narrowing on `en` would
// reject every translated string, not just missing/extra keys). Copied
// verbatim from apps/mobile/src/i18n/en.ts.
type CatalogShape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly unknown[]
      ? never
      : CatalogShape<T[K]>;
};

/**
 * Hungarian wording reuses vocabulary already shipped in
 * apps/mobile/src/i18n/hu.ts and apps/admin-web/messages/hu.json wherever the
 * same concept appears there (loader recall, geofence banners, depot
 * confirm/unload, trip-disputed, truck-idle), per the phase3 glossary
 * (bală→bála, fuvar→fuvar/cursă, tábla→parcel/field, raktár→depot,
 * sofőr→driver, rakodógép→loader). See task-6.2-report.md for the exact
 * source lines reused.
 */
export const hu: CatalogShape<typeof en> = {
  /**
   * Task 6.4. Wording reuses vocabulary already shipped in
   * apps/mobile/src/i18n/hu.ts (see syncDetails.seasonClosed there, and
   * errorApiInvalidResponse for "Érvénytelen") and
   * apps/admin-web/messages/hu.json (see season.* — "szezon", "lezárva" —
   * and accounts.* — "fiók", "Inaktív").
   */
  errors: {
    invalidData: 'Érvénytelen adatok.',
    invalidRequest: 'Érvénytelen kérés.',
    seasonClosed: 'A(z) {year}. szezon le van zárva. A bejegyzés már nem menthető.',
    accountNotFound: 'A fiók nem létezik vagy törölve lett',
    accountInactive: 'A fiók inaktív',
  },
  push: {
    common: {
      genericField: 'tábla',
      unknownCrop: 'ismeretlen termény',
      newParcel: 'új tábla',
      aParcel: 'egy tábla',
      destination: 'célállomás',
      aTruck: 'egy kamion',
      aTruckCapitalized: 'Egy kamion',
      yourField: 'az Ön táblája',
    },
    fieldEntryConfirmTruck: {
      title: 'Megérkezett a táblához?',
      body: 'A(z) {code} tábla. Automatikus megerősítés 10 mp múlva.',
    },
    fieldEntryConfirmLoad: {
      title: 'Elkezdi a rakodást?',
      body: 'A(z) {code} tábla. Automatikus megerősítés 10 mp múlva.',
    },
    loaderFieldExitConfirm: {
      title: 'Befejezte a rakodást?',
      body: 'Elhagyta a(z) {parcelName} táblát. Minden bálát felrakodott?',
    },
    balerFieldEntryConfirm: {
      title: 'Elkezdi a bálázást?',
      body: 'A(z) {code} tábla — {cropLabel}. Automatikus megerősítés 10 mp múlva.',
    },
    balerFieldExitProduction: {
      title: 'Kilépett a tábláról',
      body: 'Adja meg a bálák számát a(z) {code} táblához.',
    },
    truckUnloadedLoaderPrompt: {
      title: 'Kamion kirakodva',
      body: 'A(z) {truckCode} kamion befejezte a kirakodást. Visszahívja?',
    },
    truckIdleLoaderDeclined: {
      title: 'Kamion felszabadítva',
      body: 'A rakodógép elutasította a visszahívást — a(z) {truckCode} kamion szabad.',
    },
    truckIdleTimeout: {
      title: 'Tétlen kamion',
      body: 'A(z) {truckCode} kamion {idleMinutes} perce vesztegel.',
    },
    parcelLoadMismatch: {
      title: 'A tábla nincs teljesen felrakodva',
      body: '{label}: hiányzik {missing} bála (termelt {produced}, felrakodott {loaded}).',
    },
    depositEntry: {
      title: 'Megérkezett a raktárhoz',
      body: 'Erősítse meg az érkezést a fuvar lezárásához.',
    },
    departPrompt: {
      title: 'Elindult a tábláról?',
      body: 'Erősítse meg az indulást a raktárhoz vezető fuvar megkezdéséhez.',
    },
    truckArrivedAtLoader: {
      title: 'Megérkezett egy kamion',
      body: 'A(z) {plate} kamion megérkezett ide: {where}.',
    },
    depotTruckArrived: {
      title: 'Kamion megérkezett a raktárhoz',
      body: 'A(z) {plate} kamion megérkezett. Erősítse meg a bálákat a kirakodáshoz.',
    },
    depotTruckApproaching: {
      title: 'Közeledő kamion',
      body: 'A(z) {plate} kamion közeledik a raktárhoz (~{km} km).',
    },
    truckApproachingLoader: {
      title: 'Közeledő kamion',
      body: '{plate} kamion — a sofőr közeledik Önhöz.',
    },
    assignmentCreated: {
      title: 'Új feladat',
      body: 'Új feladata van a(z) {parcelName} táblán',
    },
    startLoading: {
      title: 'Megkezdődött a rakodás',
      body: 'A rakodógép elkezdte a kamion rakodását.',
    },
    tripLoaded: {
      title: 'A kamion megrakva',
      body: 'A bálák felrakodásra kerültek. Elindulhat.',
    },
    tripDeparted: {
      title: 'Jó utat',
      body: 'A fuvar úton van a(z) {destination} felé.',
    },
    tripArrived: {
      title: 'Megérkezett a célállomásra',
      body: 'Erősítse meg a leszállítást, amikor készen áll.',
    },
    tripCompleted: {
      title: 'Fuvar lezárva',
      body: 'A fuvar sikeresen lezárult.',
    },
    depotUnloadStarted: {
      title: 'Kirakodás folyamatban',
      body: 'A raktár kezelője elkezdte a kirakodást.',
    },
    depotConfirmed: {
      title: 'Leszállítás megerősítve a raktárban',
      body: 'A raktár megerősítette a bálákat. A fuvar lezárult.',
    },
    tripNextIteration: {
      title: 'Új fuvar',
      body: 'A rakodógép visszahívja — {iterationIndex}. fuvar.',
    },
    tripDisputed: {
      title: 'Vitatott fuvar',
      body: 'A fuvarja vitatottá vált. Vegye fel a kapcsolatot a diszpécserrel.',
    },
  },
  /** PDF document labels (Task 6.3). See ro.ts / en.ts for the source layout. */
  pdf: {
    cmr: {
      title: 'CMR FUVARLEVÉL',
      tripNoLabel: 'Fuvar sz.:',
      sectionSender: '1. FELADÓ',
      parcel: 'Tábla',
      address: 'Cím',
      sectionRecipient: '2. CÍMZETT',
      depotName: 'Raktár neve',
      sectionCarrier: '3. FUVAROZÓ',
      truck: 'Kamion',
      driver: 'Sofőr',
      sectionGoods: '4. SZÁLLÍTOTT ÁRU',
      baleCount: 'Bálák száma',
      loadCount: 'Rakodások száma',
      grossWeight: 'Bruttó súly (kg)',
      tareWeight: 'Kamion tára (kg)',
      netWeight: 'Nettó súly (kg)',
      weightTicket: 'Mérlegjegy sz.',
      sectionTripDetails: '5. FUVAR ADATAI',
      departure: 'Indulás',
      arrival: 'Érkezés',
      deliveryConfirmed: 'Leszállítás megerősítve',
      distance: 'Megtett távolság (km)',
      sectionObservations: '6. MEGJEGYZÉSEK',
      sectionSignatures: 'ALÁÍRÁSOK',
      senderOperatorSignature: 'FELADÓ / KEZELŐ',
      operatorSignatureAlt: 'A kezelő aláírása',
      driverCarrierSignature: 'SOFŐR / FUVAROZÓ',
      driverSignatureAlt: 'A sofőr aláírása',
      receiver: 'ÁTVEVŐ',
      receiverSignatureAlt: 'Az átvevő aláírása',
      footerGenerated: 'Dokumentumot automatikusan generálta:',
      footerTrip: 'Fuvar',
    },
    comanda: {
      docTitleWord: 'Rendelés',
      orderHeading: 'RENDELÉS',
      to: 'Címzett:',
      attentionOf: 'Figyelmébe:',
      intro:
        'Az Önnel folytatott telefonbeszélgetés alapján a következő adatokkal rendelünk meg határozottan egy tehergépjárművet egy fuvarhoz:',
      goodsLabel: 'Az áru megnevezése:',
      truckNoLabel: 'Rendszám:',
      driverLabel: 'Sofőr:',
      loadingLabel: 'Rakodás:',
      unloadingLabel: 'Kirakodás:',
      valueLabel: 'Fuvardíj:',
      paymentPrefix: 'Fizetési mód: átutalás az eredeti dokumentumok kézhezvételétől számított ',
      paymentSuffix: ' napon belül',
      obsLabel: 'Megjegyzés:',
      otherClauses: 'EGYÉB FELTÉTELEK:',
      confirmation: 'MEGERŐSÍTÉS,',
      transporterWord: 'FUVAROZÓ',
    },
  },
};
