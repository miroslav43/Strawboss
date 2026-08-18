import type { TranslationKeys } from './ro';

// `ro.ts` is declared `as const`, so `TranslationKeys` (= typeof ro) types every
// string leaf as its own literal (e.g. "Salvează"), not as `string`. Checking `hu`
// directly against `TranslationKeys` — with either `: TranslationKeys` or
// `satisfies TranslationKeys` — fails on every translated string, since a Hungarian
// string is not assignable to the literal type "Salvează"; it is not a key-parity
// check.
// `CatalogShape<T>` preserves the exact key structure of `T` but widens every
// string leaf to `string`, so the compiler enforces key parity in both directions
// — missing or extra keys become compile errors — while differing translated text
// does not. A leaf that is an array maps to `never` instead of recursing, so it is
// a compile error by construction the moment one is authored — the resulting
// `Type '...[]' is not assignable to type 'never'` just means "this leaf must be
// a string or a nested object, not an array." (A non-array primitive, e.g. a
// number, is already constrained to its exact literal value by the same fallback
// branch — over-strict, not a silent gap.)
type CatalogShape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly unknown[]
      ? never
      : CatalogShape<T[K]>;
};

export const hu = {
  common: {
    save: 'Mentés',
    cancel: 'Mégse',
    loading: 'Betöltés…',
    error: 'Hiba történt.',
    retry: 'Újra',
    back: 'Vissza',
    confirm: 'Megerősítés',
    yes: 'Igen',
    no: 'Nem',
    ok: 'OK',
    none: '—',
    close: 'Bezárás',
    active: 'Aktív',
    inactive: 'Inaktív',
    add: 'Hozzáadás',
    edit: 'Szerkesztés',
    delete: 'Törlés',
    search: 'Keresés',
    completed: 'Kész',
  },

  app: {
    dbError: 'Nem sikerült inicializálni az adatbázist.',
    dbRetry: 'Próbálja újra',
    profileErrorTitle: 'Kapcsolódási hiba',
    profileErrorMessage:
      'Nem sikerült betölteni a profilt. Ellenőrizze a kapcsolatot, és próbálja újra.',
  },

  auth: {
    brandTitle: 'StrawBoss',
    brandSubtitle: 'Mezőgazdasági logisztika',
    usernamePlaceholder: 'Felhasználónév vagy e-mail',
    passwordPlaceholder: 'PIN-kód vagy jelszó',
    showPassword: 'Jelszó megjelenítése',
    hidePassword: 'Jelszó elrejtése',
    loginButton: 'Bejelentkezés',
    errorRequired: 'A felhasználónév/e-mail és a jelszó megadása kötelező',
    errorUnexpected: 'Váratlan hiba történt',
    errorUserNotFound:
      'A felhasználó nem található azon a szerveren, amelyhez az alkalmazás csatlakozik. Ha látja őt az admin oldalon, állítsa be ugyanazt az EXPO_PUBLIC_API_URL értéket a .env.dev fájlban, mint az admin domain (vagy használjon tesztadatokat a helyi háttérrendszeren).',
    errorApiInvalidResponse: 'Érvénytelen API-válasz (nincs e-mail cím).',
    errorMissingApiUrl:
      'Az EXPO_PUBLIC_API_URL hiányzik. Töltse ki az apps/mobile/.env.dev fájlt, és indítsa újra a Metrót.',
    errorLoopback:
      'Nem lehet csatlakozni ehhez: {{origin}}. A telefonon (USB-n keresztül): futtassa az „adb reverse tcp:3001 tcp:3001” parancsot, majd indítsa el a háttérrendszert a Mac gépen a 3001-es porton. Hálózati hiba: {{errMsg}}',
    errorCannotContactApi:
      'Nem sikerül elérni az API-t itt: {{origin}}. Ellenőrizze a Wi-Fi-kapcsolatot/tűzfalat, és hogy a háttérrendszer a 0.0.0.0 címen figyel-e (nem csak a localhoston). {{errMsg}}',
    errorApiResolve: 'API-hiba a felhasználó azonosítása közben ({{status}}).',
    errorTimeout:
      'Nem sikerül elérni az API-szervert (időtúllépés). Ellenőrizze, hogy fut-e a háttérrendszer, hogy a telefon ugyanazon a Wi-Fi-hálózaton van-e, mint a Mac, és hogy az EXPO_PUBLIC_API_URL a helyes IP-címet használja-e (ugyanaz az előtag, mint amit a Metro mutat).',
  },

  notifications: {
    push: {
      taskAssigned: {
        title: 'Új feladat mára',
        body: 'Új feladatot kapott. Nyissa meg az alkalmazást a részletekért.',
      },
      conflictTitle: 'Az adatok frissültek a szerverről',
      fieldUpdated: '{{label}} frissült a szerverről: {{local}} → {{server}}',
      fieldLabel: {
        bale_count: 'Bálák száma',
        parcel_id: 'Tábla',
        notes: 'Megjegyzések',
        gross_weight_kg: 'Bruttó tömeg (kg)',
        tare_weight_kg: 'Önsúly (kg)',
        quantity: 'Mennyiség',
        quantity_liters: 'Liter',
        avg_bale_weight_kg: 'Átlagos bálatömeg (kg)',
      },
    },
    title: 'Értesítések',
    unreadSingular: '{{count}} olvasatlan értesítés',
    unreadPlural: '{{count}} olvasatlan értesítés',
    allRead: 'Minden értesítés olvasva',
    markAllButton: 'Összes megjelölése olvasottként',
    markAllAccessibility: 'Összes megjelölése olvasottként',
    emptyTitle: 'Nincs értesítés',
    emptyBody: 'Itt jelennek meg a fuvarjaival kapcsolatos értesítések.',
    deleteConfirmTitle: 'Törli az értesítést?',
    deleteConfirmButton: 'Törlés',
    dayToday: 'Ma',
    dayYesterday: 'Tegnap',
  },

  onboarding: {
    skipButton: 'Kihagyás',
    skipAccessibility: 'Bemutató kihagyása',
    backButton: 'Vissza',
    nextButton: 'Tovább',
    finishButton: 'Értem',
    driver: {
      slide1: {
        title: 'Az Ön feladatai',
        body: 'A főképernyőn látja az aznapra kiosztott fuvarokat. Az aktív fuvarok a lista tetején jelennek meg.',
      },
      slide2: {
        title: 'A fuvar menete',
        body: 'Minden fuvar lépéseken megy át: Indulás → Megérkezés → Kirakodás. Induláskor megadja a kilométeróra-állást, és aláír.',
      },
      slide3: {
        title: 'Üzemanyagnapló',
        body: 'Az „Üzemanyag” fülön rögzítheti a tankolásokat. Lefényképezheti a bizonylatot — automatikusan elküldésre kerül a szerverre.',
      },
      slide4: {
        title: 'Offline is működik',
        body: 'Minden rögzített adat a telefonon tárolódik, és jelerősség visszatértekor szinkronizálódik a szerverrel.',
      },
    },
    loader: {
      slide1: {
        title: 'Mai feladatok',
        body: 'A főképernyőn látja az aznapra kiosztott táblákat, fontossági sorrendben.',
      },
      slide2: {
        title: 'Bálák rakodása',
        body: 'Érintse meg a „Bálák rakodása” gombot a főképernyőn. A GPS automatikusan felismeri az aktuális táblát. Adja meg a bálák számát, és erősítse meg.',
      },
      slide3: {
        title: 'Aktív geokerítés',
        body: 'Az alkalmazás ellenőrzi, hogy Ön a kijelölt táblán belül tartózkodik-e. A táblára belépéskor és onnan kilépéskor értesítést kap.',
      },
      slide4: {
        title: 'Offline is működik',
        body: 'Minden adat helyben tárolódik, és újracsatlakozáskor automatikusan szinkronizálódik. A táblák térképe internet nélkül is elérhető.',
      },
    },
    baler: {
      slide1: {
        title: 'Mai feladatok',
        body: 'A főképernyőn látja az aznap megmunkálandó táblákat, fontossági sorrendben.',
      },
      slide2: {
        title: 'Termelés rögzítése',
        body: 'A „Termelés” képernyő számbillentyűzetével adja meg a bálák számát. Minden tétel után érintse meg a „Mentés” gombot.',
      },
      slide3: {
        title: 'Fogyóeszközök',
        body: 'A „Fogyóeszközök” fülön rögzítheti a zsineg, háló vagy más fogyóeszköz felhasználását. Lefényképezheti a bizonylatot.',
      },
      slide4: {
        title: 'Offline is működik',
        body: 'Minden adat helyben tárolódik, és jelerősség esetén automatikusan elküldésre kerül a szerverre. Egyetlen bejegyzés sem vész el.',
      },
    },
    geofence: {
      slide1: {
        title: 'Geokerítések rajzolása',
        body: 'A „Térkép” képernyőn érintse meg az „Új tábla” gombot, és rajzolja meg a tábla körvonalát pontok megérintésével a térképen.',
      },
      slide2: {
        title: 'Pontos körvonal',
        body: 'Kövesse a tábla szélét a lehető legpontosabban. Ha a körvonal kész, érintse meg a „Befejezés” gombot. Mentés előtt még javíthatja.',
      },
      slide3: {
        title: 'Gazdaságok és táblák',
        body: 'A táblák gazdaságok szerint vannak csoportosítva. Új geokerítés hozzáadása előtt válassza ki a megfelelő gazdaságot.',
      },
    },
    default: {
      slide1: {
        title: 'Üdvözöljük a StrawBossban',
        body: 'Kövesse nyomon valós időben a fuvarokat, a bálatermelést és a géppark működését.',
      },
      slide2: {
        title: 'Szinkronizált adatok',
        body: 'Az operátori telefonokról érkező összes adat automatikusan szinkronizálódik az admin irányítópulttal.',
      },
    },
  },

  trackingSetup: {
    title: 'Folyamatos nyomon követés',
    subtitle:
      'Ahhoz, hogy a pozíciója folyamatosan továbbításra kerüljön — akkor is, ha a kijelző ki van kapcsolva, vagy az alkalmazás a háttérben fut —, végezze el az alábbi {{stepCount}} lépést. Ezt csak egyszer kell elvégezni ezen a telefonon.',
    step1: {
      title: 'Helyadatok „Mindig engedélyezve”',
      body: 'Adja meg a háttérben történő helymeghatározás engedélyét (válassza a „Mindig engedélyezve” lehetőséget).',
      actionGranted: 'Megadva',
      actionGrant: 'Engedélyezés',
    },
    step2: {
      title: 'Akkumulátor-optimalizálás kikapcsolva',
      body: 'Zárja ki az alkalmazást az akkumulátor-optimalizálásból, hogy a rendszer ne állítsa le a háttérben.',
      actionExempt: 'Kizárva',
      actionDisable: 'Kikapcsolás',
    },
    step3: {
      title: 'Automatikus indítás',
      body: 'Engedélyezze a StrawBoss „Automatikus indítás” funkcióját a gyártói beállításokban, hogy újraindulás után is elinduljon.',
      action: 'Megnyitás',
    },
    step4: {
      title: 'Teljes képernyős riasztások',
      body: 'Engedélyezze a riasztások megjelenítését a zárolt képernyőn is, hogy azonnal lássa, amikor belép egy táblára, vagy elhagyja azt.',
      actionGranted: 'Megadva',
      actionOpen: 'Megnyitás',
    },
    finishButton: 'Kész, tovább',
    fgsTitle: 'StrawBoss — helymeghatározás aktív',
    fgsBody: 'A pozíciót továbbítjuk a diszpécsernek.',
  },

  dailyReport: {
    headerTitle: 'Napi jelentés',
    backAccessibility: 'Vissza',
    loadingText: 'Tevékenység betöltése…',
    emptyText: 'Ma nem történt rögzített tevékenység.',
    retryButton: 'Próbálja újra',
    exportButton: 'PDF exportálása',
    exportButtonAccessibility: 'PDF exportálása',
    exportErrorFallback: 'Nem sikerült létrehozni a PDF-et.',
    kpi: {
      bales: 'Termelt bálák',
      fuel: 'Üzemanyag',
      loads: 'Rakodások',
      consumables: 'Fogyóeszközök',
    },
    syncStatus: {
      synced: 'szinkronizálva ✓',
      pending: 'függőben',
      failed: 'sikertelen ✗',
    },
    pdf: {
      title: 'StrawBoss — Napi jelentés',
      noRecords: 'Nincs bejegyzés',
      kpi: {
        balesProduced: 'Termelt bálák',
        fuelFilled: 'Tankolt üzemanyag',
        baleLoads: 'Bálarakodások',
        consumablesLogged: 'Rögzített fogyóeszközök',
      },
      section: {
        production: 'Bálatermelés',
        fuel: 'Üzemanyag',
        loads: 'Bálarakodások',
        consumables: 'Fogyóeszközök',
      },
      col: {
        time: 'Idő',
        quantity: 'Mennyiség',
        details: 'Részletek',
        sync: 'Szinkron',
      },
    },
    shareDialogTitle: 'StrawBoss napi jelentés — {{date}}',
  },

  syncDetails: {
    featureDisabled:
      'Ezt a funkciót egy adminisztrátor kikapcsolta. A bejegyzés mentve marad, és elküldésre kerül, ha újra bekapcsolják.',
    seasonClosed:
      'Az a szezon, amelyhez ez a bejegyzés tartozik, le lett zárva egy adminisztrátor által, ezért már nem fogad új bejegyzéseket. A megadott adatok nem vesznek el — értesítse az adminisztrátort.',
    terminalRejection:
      'A szerver elutasította ezt a bejegyzést. Az újrapróbálkozás nem segít — végezze el újra a műveletet a hozzá tartozó képernyőn.',
    incompleteResponseError: 'Hiányos szerverválasz ehhez a bejegyzéshez',
    title: 'Függőben lévő adatok',
    refreshAccessibility: 'Frissítés',
    backAccessibility: 'Vissza',
    networkLabel: 'Hálózat:',
    online: 'Online',
    offline: 'Offline',
    pendingLabel: 'Függőben:',
    failedLabel: 'Sikertelen:',
    lastSyncLabel: 'Utolsó szinkronizálás:',
    lastSyncNever: 'Soha',
    retryAllButton: 'Összes újra',
    retryAllAccessibility: 'Minden sikertelen bejegyzés újraküldése',
    syncNowButton: 'Szinkronizálás most',
    syncNowNoConnection: 'Nincs kapcsolat',
    syncNowAccessibility: 'Szinkronizálás most',
    retryEntryButton: 'Újra',
    retryEntryAccessibility: 'Bejegyzés újraküldése',
    statusPending: 'függőben',
    statusFailed: 'sikertelen',
    retryCount: 'Próbálkozások: {{count}}',
    emptyTitle: 'Minden szinkronizálva',
    emptySubtitle: 'Nincs függőben lévő vagy sikertelen bejegyzés.',
    entityLabel: {
      trips: 'Fuvar',
      baleLoads: 'Bálarakodás',
      baleProductions: 'Bálatermelés',
      fuelLogs: 'Üzemanyagnapló',
      consumableLogs: 'Fogyóeszköz',
      operations: 'Művelet',
      taskAssignments: 'Feladat',
    },
    actionLabel: {
      create: 'létrehozás',
      update: 'módosítás',
      delete: 'törlés',
      transition: 'állapotváltás',
    },
  },

  specimenCapture: {
    headerTitleNew: 'Aláírásminta',
    headerTitleRedo: 'Aláírásminta módosítása',
    titleNew: 'Hozza létre az aláírását',
    titleRedo: 'Rajzolja újra az aláírását',
    hint: 'A minta minden fuvarnál felhasználásra kerül (sofőr indulása, kezelői rakodás). Ügyeljen rá, hogy olvasható legyen.',
    signatureLabel: 'Az Ön aláírása',
    cancelButton: 'Mégse',
    errorTitle: 'Hiba',
    errorFallback:
      'Az aláírásmintát nem sikerült menteni. Ellenőrizze a kapcsolatot, és próbálja újra.',
  },

  webOnly: {
    title: 'Kezelés a webes irányítópulton',
    body: 'A fiókját (diszpécser/adminisztrátor) a StrawBoss webes irányítópultjáról kezelik. Ebben a mobilalkalmazásban nincs teendője — az a sofőrök és terepi gépkezelők számára készült.',
  },

  tabs: {
    label: {
      home: 'Kezdőlap',
      production: 'Termelés',
      map: 'Térkép',
      consumables: 'Fogyóeszközök',
      profile: 'Profil',
      myTrips: 'Fuvaraim',
      delivery: 'Kiszállítás',
      fuel: 'Üzemanyag',
      trucks: 'Kamionok',
      loads: 'Rakományok',
      diesel: 'Gázolaj',
      farms: 'Gazdaságok',
      inventory: 'Készlet',
      incomingTrips: 'Fuvarok',
      scan: 'Beolvasás',
      sync: 'Szinkronizálás',
    },
    home: {
      title: 'StrawBoss',
      subtitle: 'Mezőgazdasági logisztika',
      connectionCardTitle: 'Kapcsolat',
      online: 'Online',
      offline: 'Offline',
      machineCardTitle: 'Saját gép',
      noMachineTitle: 'Nincs hozzárendelt gép',
      noMachineSubtitle: 'Vegye fel a kapcsolatot az adminisztrátorral egy gép hozzárendeléséhez.',
      machineTypeLoader: 'Rakodógép',
      machineTypeBaler: 'Bálázó',
      machineTypeTruck: 'Kamion',
      gpsActiveAndroid: 'GPS aktív (háttérben is)',
      gpsInactiveAndroid: 'A GPS nem fut — ellenőrizze a „Mindig” engedélyt',
      gpsActiveIos: 'GPS aktív',
      gpsInactiveIos: 'GPS: engedélyezze az alkalmazás beállításaiban (iOS)',
      lastPing: 'Utolsó jelzés: {{time}}',
      waitingFirstPing: 'Várakozás az első jelzésre…',
      machineLoadError: 'Nem sikerült betölteni a hozzárendelt gépet.',
      syncCardTitle: 'Szinkronizálás',
      syncQueueLabel: 'Várólistán (hibákkal együtt):',
      syncLastSyncLabel: 'Utolsó szinkronizálás:',
      syncNever: 'Soha',
      syncing: 'Szinkronizálás…',
    },
    scan: {
      requestingPermission: 'Kameraengedély kérése…',
      permissionRequired: 'QR-kód beolvasásához kamerahozzáférés szükséges',
      grantPermission: 'Engedély megadása',
      instruction: 'Irányítsa a kamerát egy StrawBoss QR-kódra',
      scanAgain: 'Új beolvasás',
      scannedTitle: 'Beolvasva',
      scannedMessage: 'Kód: {{data}}',
    },
    sync: {
      title: 'Szinkronizálás',
      networkLabel: 'Hálózat:',
      online: 'Online',
      offline: 'Offline',
      queueLabel: 'Várólistán (hibákkal együtt):',
      lastSyncLabel: 'Utolsó szinkronizálás:',
      lastSyncNever: 'Soha',
      syncNowButton: 'Szinkronizálás most',
      noConnectionButton: 'Nincs kapcsolat',
      recentErrorsTitle: 'Legutóbbi hibák',
      failedEntriesTitle: 'Sikertelen bejegyzések ({{count}})',
      unknownError: 'Ismeretlen hiba',
      retryCountLabel: 'Próbálkozások: {{count}}',
      retryButton: 'Újra',
    },
    trips: {
      title: 'Aktív fuvarok',
      noNumber: 'Nincs szám',
      baleCount: 'Bálák: {{count}}',
      departed: 'Indulás: {{time}}',
      emptyTitle: 'Nincs aktív fuvar',
      emptySubtext: 'A hozzárendelt fuvarok itt jelennek meg',
    },
  },

  driver: {
    screenTitle: {
      myTrips: 'Fuvarjaim',
      delivery: 'Leszállítás',
    },
    statusLabel: {
      planned: 'Tervezett',
      loading: 'Rakodás alatt',
      loaded: 'Felrakodva',
      inTransit: 'Úton',
      arrived: 'Megérkezett',
      delivering: 'Kirakodás alatt',
      delivered: 'Leszállítva',
      completed: 'Lezárva',
    },
    taskStatusLabel: {
      available: 'Nincs elkezdve',
      inProgress: 'Folyamatban',
      done: 'Kész',
    },
    card: {
      activeLoaders: 'Aktív rakodógépek',
      noNearbyLoader: 'Nincs rakodógép a közelben.',
      todayTask: 'Mai feladat',
      tripNotStarted: 'A fuvar még nem indult el',
    },
    badge: {
      new: 'ÚJ',
    },
    trip: {
      fallbackName: 'Fuvar',
      baleCount: 'bála',
      iterationLabel: 'Fuvar {n}',
    },
    hint: {
      tapToDeliver: 'Koppintson a leszállításhoz',
      tapToDepart: 'Koppintson az induláshoz',
    },
    empty: {
      noActiveTrips: 'Nincs aktív fuvar.',
      assignedTripsHint: 'A hozzárendelt fuvarok itt jelennek meg.',
    },
    delivery: {
      empty: {
        noActiveTrip: 'Nincs aktív fuvar.',
        hint: 'A fuvar itt jelenik meg, amíg aktív, egészen a leszállításig.',
      },
    },
    activeTripCard: {
      sectionLabel: 'Aktív fuvar',
      status: {
        planned: 'Tervezett',
        loading: 'Rakodás alatt',
        loaded: 'Felrakodva',
        inTransit: 'Úton',
        arrived: 'Megérkezett',
        delivering: 'Kirakodás alatt',
        delivered: 'Leszállítva',
        completed: 'Lezárva',
      },
      action: {
        depart: 'Indulás',
        markArrival: 'Érkezés jelölése',
        startDelivery: 'Leszállítás indítása',
        confirmDelivery: 'Leszállítás megerősítése',
        finalize: 'Lezárás',
      },
      tripFallbackLabel: 'Fuvar',
      baleCount: '{count} bála',
      insideGeofence: 'Geokerítésen belül',
      viewDetails: 'Részletek megtekintése',
    },
    depotArrivalOverlay: {
      actionLabel: 'Érkezés a raktárhoz',
      confirmLabel: 'Megerősítés most',
    },
    tripLoadedOverlay: {
      title: 'Kamion megrakva!',
      subtitle: 'Fuvar {tripNumber}',
      balesLoaded: '{count} bála felrakodva',
      noDestination: 'Nincs beállítva célállomás — válassza ki a részleteknél',
      action: {
        startTrip: 'Fuvar indítása',
        chooseDestination: 'Célállomás kiválasztása',
        later: 'Később',
      },
    },
  },

  deliveryFlow: {
    error: {
      tripNotFound: 'A fuvar nem található.',
    },
    button: {
      backToTrips: 'Vissza a fuvarokhoz',
    },
    trip: {
      fallbackName: 'Fuvar',
    },
  },

  departureFlow: {
    screenTitle: 'Fuvar indítása',
    hint: 'Erősítse meg az indulást a raktárhoz vezető fuvar elindításához.',
    button: {
      confirmDeparture: 'Indulás megerősítése',
      cancel: 'Mégse',
    },
    countdown: {
      actionLabel: 'Indulás a tábláról',
    },
    alert: {
      error: {
        title: 'Hiba',
        message: 'Nem sikerült elindítani a fuvart. Kérjük, próbálja újra.',
      },
    },
  },

  tripDetail: {
    screenTitle: {
      fallback: 'Fuvar',
    },
    loading: {
      text: 'Betöltés…',
    },
    error: {
      notFound: 'A fuvar nem található',
    },
    button: {
      back: 'Vissza',
    },
    navigate: {
      toLoaderLive: 'Navigálás a rakodógéphez',
      toField: 'Navigálás a táblához',
      unavailable: 'A rakodógép helyzete nem elérhető',
    },
    card: {
      tripDetails: 'Fuvar részletei',
    },
    infoRow: {
      tripNumber: 'Fuvarszám',
      parcel: 'Tábla',
      loader: 'Rakodógép',
      destination: 'Célállomás',
      address: 'Cím',
      bales: 'Bálák',
      grossWeight: 'Bruttó tömeg',
      departedAt: 'Indulás ideje',
      arrivedAt: 'Érkezés ideje',
      deliveredAt: 'Leszállítás ideje',
    },
    actions: {
      sectionTitle: 'Műveletek',
      waitingForLoader: 'Várakozás, amíg a rakodógép megrakja a kamiont.',
      chooseDepot: {
        title: 'Raktár kiválasztása',
        subtitle: 'Válassza ki a célállomást indulás előtt',
      },
      depart: {
        title: 'Indulás',
        subtitle: 'Írjon alá az induláshoz',
      },
      arrive: {
        title: 'Megérkezett a célállomásra',
        subtitle: 'Érkezés megerősítése',
      },
      delivery: {
        title: 'Leszállítás',
        subtitle: 'Mérés, fénykép és átvevő aláírása',
      },
    },
    done: {
      completed: 'A fuvar lezárva.',
      cancelled: 'A fuvar törölve.',
    },
    viewer: {
      text: 'Ön a fuvar státuszát tekinti meg. A műveleteket a sofőr végzi.',
    },
    modal: {
      chooseDepot: {
        title: 'Raktár kiválasztása',
      },
      error: {
        loadDepots: 'Nem sikerült betölteni a raktárakat.',
      },
      empty: {
        noActiveDepots: 'Nincs aktív raktár.',
      },
      defaultBadge: 'alapértelmezett',
    },
    alert: {
      error: {
        saveDepot: 'Nem sikerült menteni a raktárt.',
        arrive: 'Nem sikerült rögzíteni az érkezést.',
        title: 'Hiba',
      },
    },
  },

  loader: {
    home: {
      screenTitle: 'Kamionok',
      recallTitle: 'Kamion kirakodva',
      recallBody: 'A(z) {truckCode} kamion befejezte a kirakodást. Visszahívja?',
      recallConfirm: 'Visszahívás',
      recallDecline: 'Nem hívom vissza',
      sectionTrucksAtLoader: 'Kamionok a rakodógépnél',
      noLoaderAssignedTitle: 'Nincs hozzárendelt rakodógép',
      noLoaderAssignedSubtitle:
        'Kérje meg az adminisztrátort, hogy rendeljen Önhöz egy rakodógépet.',
      searchingTrucks: 'Kamionok keresése…',
      noTrucksNearbyTitle: 'Nincs kamion a közelben',
      noTrucksNearbySubtitle:
        'A lista 10 másodpercenként automatikusan frissül. Amint egy kamion közeledik, itt fog megjelenni.',
      sectionAuxTrucks: 'Kisegítő kamionok',
      searchingAuxTrucks: 'Kisegítő kamionok keresése…',
      noAuxTrucksTitle: 'Nincs kisegítő kamion',
      noAuxTrucksSubtitle:
        'A diszpécser által hozzárendelt kisegítő kamionok itt jelennek meg, a távolságtól függetlenül.',
      truckFallbackLabel: 'Kamion',
      truckDistancePrefix: '{distance} távolságra',
      badgeLoaded: 'Felrakodva',
      badgeReadyToLoad: 'Rakodásra kész',
      auxTruckFallbackLabel: 'Kisegítő kamion',
      baleCountSuffix: '{count} bála',
      baleQualityLabel: 'Bála minősége',
      quality1: '1. minőség',
      quality2: '2. minőség',
      // Assignment-aware loader board
      sectionAssignedTrucks: 'Rakodandó kamionok',
      sectionNearbyUnassigned: 'Egyéb kamionok a közelben',
      noAssignedTrucksTitle: 'Ma nincs hozzárendelt kamion',
      noAssignedTrucksSubtitle:
        'A diszpécser által ehhez a rakodógéphez rendelt kamionok itt jelennek meg.',
      badgeHereNow: '● Itt van',
      badgeEnroute: '○ Úton',
      badgePresenceLoaded: '✓ Felrakodva',
      fieldPrefix: 'Tábla: {field}',
      tagUnassigned: 'nincs hozzárendelve',
      distanceMeters: '{distance} m',
      distanceKm: '{distance} km',
    },
    bales: {
      screenTitle: 'Rakodások',
      statusPlanned: 'Tervezett',
      statusLoading: 'Rakodás alatt',
      statusLoaded: 'Felrakodva',
      statusInTransit: 'Úton',
      statusCompleted: 'Lezárva',
      truckFallbackLabel: 'Ismeretlen kamion',
      tripBaleCountLoaded: '{count} bála felrakodva',
      tripCtaText: 'Koppintson a rakodás rögzítéséhez →',
      sectionTrucksToLoad: 'Ma rakodandó kamionok',
      loadingTrips: 'Fuvarok betöltése…',
      noTripsPlanned: 'Ma nincs tervezett fuvar.',
      noTripsSubtext:
        'Az adminisztrátor még nem tervezett fuvarokat, vagy Ön nincs rakodógép-kezelőként hozzárendelve.',
      sectionLoadsToday: 'Ma rögzített rakodások',
      noLoadsToday: 'Ma még nincs rögzített rakodás.',
      cardLabelBales: 'Bálák',
      cardLabelTime: 'Idő',
    },
    consumables: {
      screenTitle: 'Üzemanyag',
      subtitle: 'Tankolás rögzítése',
    },
    loadBales: {
      screenTitle: 'Tele kamion',
      errorNoTruck: 'Hiba',
      errorNoTruckMessage: 'Nincs azonosított kamion.',
      errorNoTruckOk: 'OK',
      gpsActive: 'GPS aktív',
      gpsLocating: 'Helymeghatározás…',
      gpsNone: 'Nincs GPS',
      parcelCardLabel: 'Tábla',
      depotCardLabel: 'Raktár',
      depotRequiresConnectionTitle: 'Kapcsolat szükséges',
      depotRequiresConnectionMessage:
        'A raktárból történő rakodáshoz internetkapcsolat szükséges. Csatlakozzon újra, és próbálja meg ismét.',
      parcelIdentifying: 'Azonosítás…',
      parcelUnconfirmedFallback: 'A tábla meghatározása a pozíció alapján…',
      fieldStateNoAssignmentTitle: 'Ma nincs hozzárendelt tábla',
      fieldStateNoAssignmentBody:
        'A diszpécser ma nem rendelt Önhöz táblát. Vegye fel vele a kapcsolatot, majd próbálja újra.',
      fieldStateOutsideTitle: 'Ön egyik táblán sincs',
      fieldStateOutsideBody:
        'Hajtson be a táblára, amelyen dolgozik. Azt a rendszer automatikusan felismeri a pozíció alapján — kézzel nem választható ki.',
      fieldStateLocatingTitle: 'GPS-jel keresése…',
      fieldStateLocatingBody:
        'Tartsa a telefont szabad téren. Amint van jel, a tábla önműködően azonosításra kerül.',
      fieldStateGpsOffTitle: 'A helymeghatározás ki van kapcsolva',
      fieldStateGpsOffBody:
        'Engedélyezze a helymeghatározást az alkalmazásnak — enélkül a tábla nem azonosítható.',
      fieldStateMissingGeometryTitle: 'A táblák körvonalai nincsenek letöltve',
      fieldStateMissingGeometryBody:
        'Ezen a telefonon még nincsenek letöltve a táblái körvonalai, így a pozíciója nem párosítható egyikhez sem. Töltse le őket, és a probléma önműködően megoldódik.',
      fieldStateMissingGeometryOfflineBody:
        'Ezen a telefonon még nincsenek letöltve a táblái körvonalai, és nincs kapcsolat a letöltésükhöz. Csatlakozzon az internethez, és a probléma önműködően megoldódik.',
      fieldStateAssignedListTitle: 'Mai táblái:',
      fieldStateDownloadOutlines: 'Körvonalak letöltése',
      fieldStateDownloadingOutlines: 'Letöltés…',
      fieldStateRetryGps: 'GPS újra',
      presenceInside: '● Ön a táblán van',
      presenceAwayFromField: '● {distance} m-re a táblától — menjen közelebb a rakodáshoz',
      presenceNear: '● Közel a táblához ({distance} m)',
      presenceGpsUnavailable: '● GPS nem elérhető — engedélyezze a helymeghatározást',
      presenceVerifying: 'Pozíció ellenőrzése…',
      baleCountFieldLabel: 'Felrakodott bálák száma',
      fullTruckButton: 'Tele kamion ({count} bála)',
      registerButton: 'Rögzítés',
      cancelButton: 'Mégse',
      gateHintAwayFromField: 'A rakodáshoz a táblán kell tartózkodnia ({distance} m a táblától).',
      gateHintGpsUnavailable: 'A pozíció nem igazolható — a rakodáshoz engedélyezze a GPS-t.',
      gateHintWaitingGps: 'GPS-jelre várakozás annak igazolásához, hogy a táblán tartózkodik…',
      gateHintAuxGpsUnavailable:
        'A rakodáshoz engedélyezze a GPS-t, vagy erősítse meg a táblát a főképernyőn.',
      gateHintAuxDeterminingField: 'A tábla meghatározása a pozíció alapján…',
      modalNotInFieldTitle: 'Ön nincs a táblán',
      modalNotInFieldMessage:
        'A rakodáshoz a(z) {parcelName} táblán kell tartózkodnia. Ön {distance} m-re van a táblától — menjen közelebb, és próbálja újra.',
      modalPositionUnconfirmedTitle: 'A pozíció nincs igazolva',
      modalPositionUnconfirmedMessage:
        'Nem igazolható, hogy a táblán tartózkodik (a GPS nem elérhető, vagy a helymeghatározás ki van kapcsolva). Engedélyezze a helymeghatározást, és próbálja újra.',
      modalRetryGps: 'GPS újra',
      modalDeterminingPositionTitle: 'Pozíció meghatározása',
      modalDeterminingPositionMessage:
        'Várja meg a GPS-jelet annak igazolásához, hogy a táblán tartózkodik, majd próbálja újra.',
      modalUnderstood: 'Rendben',
      modalDuplicateLoadTitle: 'Nemrégi rakodás észlelve',
      modalDuplicateLoadMessage:
        'Már rögzített {totalBales} bálát ehhez a kamionhoz és táblához {minutesAgo} perce. Folytatja egy új rögzítéssel?',
      modalContinue: 'Igen, folytatás',
      modalParcelFullyLoadedTitle: 'A tábla teljesen fel van rakodva',
      modalParcelFullyLoadedMessage:
        'Ezen a táblán már minden bála fel van rakodva. Válasszon másik táblát, vagy értesítse a diszpécsert.',
      modalParcelCountExceedsTitle: 'Túl nagy mennyiség a táblához',
      modalParcelCountExceedsMessage:
        'Ezen a táblán már csak {remaining} bála áll rendelkezésre. Csökkentse a mennyiséget, vagy válasszon másik táblát.',
      modalTruckCapacityTitle: 'A kamion kapacitása túllépve',
      modalTruckCapacityMessage: 'A kamion legfeljebb {maxBales} bálát szállíthat.',
      successScreenTitle: 'Tele kamion',
      successText: 'Rögzítve!',
      successSubtext: 'A fuvar létrejött a sofőr számára.',
      signatureScreenTitle: 'Kezelői aláírás',
      signatureTitle: 'Rakodás aláírása',
      signatureHint: 'Erősítse meg, hogy {baleCount} bálát rakodott a(z) {truckLabel} kamionba.',
      specimenLabel: 'Aláírásminta',
      specimenMissing: 'Még nincs aláírásmintája.',
      signWithSpecimenButton: 'Aláírás mintával',
      specimenMissingAlertTitle: 'Hiányzó aláírásminta',
      specimenMissingAlertMessage: 'Még nincs aláírásmintája. Hozzon létre egyet a profiljából.',
      specimenMissingAlertAction: 'Aláírásminta létrehozása',
      cmrScanScreenTitle: 'CMR',
      cmrScanTitle: 'CMR beolvasása',
      cmrScanHint:
        'Fényképezze le a sofőrtől kapott fuvarokmányt (CMR). {baleCount} bálát rakodott a(z) {truckLabel} kamionba.',
      cmrScanButton: 'CMR beolvasása',
      cmrScanAddPage: 'További oldal hozzáadása',
      cmrScanDeletePage: 'Oldal eltávolítása',
      cmrScanPagesLabel: '{count} oldal beolvasva',
      cmrScanConfirmButton: 'Megerősítés és küldés',
      cmrScanBuildingPdf: 'Dokumentum előkészítése…',
      cmrScanUnavailableTitle: 'A szkenner nem elérhető',
      cmrScanUnavailableMessage:
        'A dokumentumszkenner nem érhető el ezen a telefonon. Készíthet helyette egy egyszerű fényképet, automatikus vágás nélkül.',
      cmrScanFallbackPhotoButton: 'Fénykép készítése',
      cmrScanPdfFailedTitle: 'Nem sikerült létrehozni a dokumentumot',
      cmrScanPdfFailedMessage: 'Próbálja újra beolvasni az oldalakat.',
      cmrScanNoTripTitle: 'A fuvar nem azonosítható',
      cmrScanNoTripMessage:
        'Offline módban a CMR nem csatolható a fuvarhoz. Nyissa meg újra a kisegítő kamiont a főképernyőről, vagy csatlakozzon újra az internethez.',
      giveUpButton: 'Kilépés',
      truckFallbackLoading: '…',
      truckFallbackUnknown: 'Ismeretlen kamion',
      alertErrorTitle: 'Hiba',
      alertErrorFallbackMessage: 'Nem sikerült rögzíteni a rakodást.',
      alertParcelCountExceedsTitle: 'Túl nagy mennyiség a táblához',
      alertParcelCountExceedsFallback: 'Ezen a táblán még {remaining} bála áll rendelkezésre.',
      alertParcelFullyLoadedTitle: 'A tábla teljesen fel van rakodva',
      alertParcelFullyLoadedFallback: 'Ezen a táblán már minden bála fel van rakodva.',
      alertTruckCapacityTitle: 'A kamion kapacitása túllépve',
      alertTruckCapacityFallback: 'A kamion legfeljebb {truckCap} bála kapacitású.',
      modalCancel: 'Mégse',
      // Presence when we have a GPS fix but nothing to check it against —
      // distinct from "still locating" (presenceVerifying) and from "no GPS
      // at all" (presenceGpsUnavailable).
      presenceUnverifiableOffline: '● A pozíció nem ellenőrizhető (offline)',
      presenceUnverifiableNoGeometry:
        '● Ennek a táblának a körvonala nincs eltárolva ezen a telefonon',
      gateHintUnverifiable:
        'Offline módban nem tudjuk ellenőrizni a pozícióját. Így is rögzítheti — a GPS-pozíció mentésre kerül ellenőrzés céljából.',
      modalUnverifiableTitle: 'A pozíció nincs ellenőrizve',
      modalUnverifiableMessage:
        'A(z) {parcelName} tábla körvonala nincs eltárolva ezen a telefonon (Ön offline van). A rakodás a GPS-pozíciójával kerül mentésre, és szinkronizáláskor felülvizsgálatra kerül. Folytatja?',
      modalUnverifiableConfirm: 'Igen, rögzítés',
      modalUnverifiableCancel: 'Mégse',
      offlineBannerTitle: 'Ön offline van',
      offlineBannerBody:
        'A telefon gyorsítótárából dolgozik. Ez automatikusan elküldésre kerül, amint újra csatlakozik.',
    },
    recallOverlay: {
      title: 'Kamion kirakodva',
      question: 'Visszahívja egy újabb fuvarhoz?',
      action: {
        yes: 'Igen, visszahívás',
        no: 'Nem',
      },
    },
  },

  baler: {
    home: {
      screenTitle: 'Bálázó',
      operatorFallback: 'Kezelő',
    },
    consumables: {
      screenTitle: 'Fogyóeszközök',
    },
    production: {
      screenTitle: 'Termelés',
      subtitle: 'Adja meg a bálák számát',
      fieldActiveToggleLabel: 'Aktív tábla',
      fieldActiveToggleAccessibility: 'Aktív tábla mód bekapcsolása',
      fieldActiveBadge: 'Aktív tábla',
      exitButton: 'Kilépés',
      exitButtonAccessibility: 'Kilépés az Aktív tábla módból',
    },
    parcelDetail: {
      primaryActionLabel: 'Termelés rögzítése',
    },
    productionEntry: {
      screenTitleWithCode: 'Termelés — {{parcelCode}}',
      screenTitleFallback: 'Termelés',
      baleCountLabel: 'Hány bálát termelt?',
      finishFieldLabel: 'Hogyan fejezte be a táblát?',
      submitButton: 'Beküldés',
      submitButtonSaving: 'Küldés…',
      errorNoFinish: 'Beküldés előtt válasszon: Részben betakarítva vagy Teljesen betakarítva.',
      errorNoAssignment: 'Hiányzik a feladatazonosító.',
      errorSubmitFailed: 'Nem sikerült beküldeni. Ellenőrizze a kapcsolatot, és próbálja újra.',
    },
  },

  deposit: {
    screenTitle: 'Raktárkészlet',
    noDepotTitle: 'Nincs hozzárendelt raktár',
    noDepotSubtitle: 'Kérje meg az adminisztrátort, hogy rendeljen raktárt a fiókjához.',
    dataUnavailableTitle: 'Az adatok nem érhetők el',
    dataUnavailableSubtitle: 'Csatlakozzon az internethez, és húzza le a szinkronizáláshoz.',
    statLabelBales: 'bála',
    statLabelTons: 'tonna',
    lastDelivery: 'Utolsó szállítás: {date}',
    incomingTripsCount: '{count} fuvar úton',
    noIncomingTripsInline: 'Nincs érkező fuvar.',
    tripIteration: 'fuvar {index}',
    tripBaleCount: '{count} bála',
  },

  confirmDelivery: {
    successScreenTitle: 'Leszállítás megerősítve',
    successMessage: 'Leszállítás megerősítve!',
    successSubtext: '{count} bála rögzítve — {truck}.',
    notFoundScreenTitle: 'Leszállítás megerősítése',
    notFoundTitle: 'A fuvar nem található',
    notFoundSubtitle:
      'Előfordulhat, hogy a fuvar már megerősítve van, vagy nem az Ön raktárához irányul.',
    backButton: 'Vissza',
    mainScreenTitle: 'Leszállítás megerősítése',
    geofenceInsideLabel: 'A kamion a raktár kerületén belül van',
    geofenceDistanceLabel: '{distance} m a raktártól',
    geofenceUnknownPosition: 'Ismeretlen pozíció',
    geofenceInPerimeter: 'Kerületen belül',
    geofenceWaiting: 'Várakozás, amíg a kamion belép a megerősítési sugárba.',
    geofenceNoRecentLocation: 'Nincs friss helyadat.',
    truckBalesLoaded: '{count} bála felrakodva',
    fieldLabelBaleCount: 'Megerősített bálaszám',
    scaleBrokenLabel: 'A mérleg elromlott',
    scaleBrokenSubtitle: 'Kapcsolja be, ha a mérleg elromlott — csak a bálaszám kerül rögzítésre.',
    fieldLabelWeights: 'Tömegek (kg)',
    weightFieldGross: 'Bruttó (mért)',
    weightFieldTare: 'Önsúly (üres kamion)',
    netLabel: 'Nettó',
    tareExceedsGrossError: 'Az önsúly nem lehet nagyobb, mint a bruttó tömeg.',
    editingHint: 'Szerkesztés: {field}',
    editingFieldGross: 'Bruttó',
    editingFieldTare: 'Önsúly',
    scaleBrokenNotice: 'A tömegek nem kerülnek rögzítésre (a mérleg elromlott).',
    gateHintWithDistance: 'A megerősítés nem elérhető — a kamion {distance} m-re van a raktártól.',
    gateHintNoPosition: 'A megerősítés nem elérhető — a kamion pozíciója ismeretlen.',
    perimeterWarnWithDistance:
      'Úgy tűnik, a kamion {distance} m-re van a raktártól. Ekkor is megerősítheti — ilyenkor szavatolnia kell érte.',
    perimeterWarnNoPosition:
      'A kamion pozíciója ismeretlen. Ekkor is megerősítheti — ilyenkor szavatolnia kell érte.',
    submitButtonSaving: 'Mentés…',
    submitButton: 'Leszállítás megerősítése',
    cancelButton: 'Mégse',
    modalGeofenceTitle: 'Ön nincs a raktár kerületén belül',
    modalGeofenceMessageWithDistance:
      'A megerősítési sugáron belül kell lennie. Ön {distance} m-re van a raktártól.',
    modalGeofenceMessageNoPosition:
      'A kamion raktárhoz viszonyított pozíciója nem határozható meg.',
    modalGeofenceConfirm: 'Rendben',
    alertIncompleteBalesTitle: 'Hiányos adatok',
    alertIncompleteBalesMessage: 'Adja meg a bálák számát.',
    alertIncompleteWeightsTitle: 'Hiányos adatok',
    alertIncompleteWeightsMessage: 'Adja meg helyesen a bruttó tömeget és az önsúlyt.',
    errorTitle: 'Hiba',
    errorMessage: 'Nem sikerült megerősíteni a leszállítást. Kérjük, próbálja újra.',
  },

  depositTrips: {
    screenTitle: 'Érkező fuvarok',
    statusInTransit: 'Úton',
    statusArrived: 'Megérkezett',
    statusDelivering: 'Kirakodás alatt',
    emptyTitle: 'Nincs érkező fuvar',
    emptySubtitle: 'A raktárhoz tartó fuvarok itt jelennek meg.',
    tripIteration: 'fuvar {index}',
    geofenceBadge: 'kerületen belül',
    tripBaleCount: '{count} bála',
    distanceInsideGeofence: 'Raktár kerületén belül',
    distanceFromDepot: '{distance} m a raktártól',
    distanceUnknown: 'Ismeretlen pozíció',
    confirmDeliveryButton: 'Leszállítás megerősítése',
    // Two-step unloading + GPS override
    statusUnloading: 'Kirakodás',
    startUnloadButton: 'Kirakodás indítása',
    finishUnloadButton: 'Kirakodás befejezése',
    confirmAnywayButton: 'Megerősítés mindenképp',
    distanceFromDepotKm: '{distance} km a raktártól',
    blockedNoGps: 'A kamion mostanában nem jelentett pozíciót.',
    blockedOutside: 'A kamion {distance} m-re van a raktártól.',
    blockedUnlinked:
      'Ez a fuvar nincs az Ön raktárához kapcsolva — érvényes GPS-pozíció szükséges.',
    overrideTitle: 'Megerősíti GPS-ellenőrzés nélkül?',
    overrideMessageDistance:
      'A kamion pozíciója szerint {distance} m-re van a raktártól. Csak akkor erősítse meg, ha látja a kamiont a rámpánál — a művelet felülvizsgálatra lesz megjelölve.',
    overrideMessageNoGps:
      'A kamion mostanában nem jelentett pozíciót. Csak akkor erősítse meg, ha látja a kamiont a rámpánál — a művelet felülvizsgálatra lesz megjelölve.',
    overrideConfirm: 'Igen, a kamion itt van',
    startFailedTitle: 'Nem sikerült elindítani a kirakodást',
    startFailedMessage: 'Próbálja újra egy pillanat múlva.',
  },

  geofenceFarms: {
    screenTitle: 'Gazdaságok',
    addFarmButton: 'Új gazdaság',
    loadingText: 'Gazdaságok betöltése…',
    emptyTitle: 'Nincs regisztrált gazdaság',
    emptySub: 'Koppintson az „Új gazdaság” gombra az első gazdaság hozzáadásához.',
    entityTypeLegal: 'Jogi személy',
    entityTypeNatural: 'Természetes személy',
    farmFieldCount: '{count} tábla',
    noParcelsForFarm: 'Ehhez a gazdasághoz nincs hozzárendelt tábla.',
    unassignedFarmName: 'Nincs gazdaság',
    unassignedParcelCount: '{count} hozzá nem rendelt tábla',
    harvestStatusPlanned: 'Tervezett',
    harvestStatusToHarvest: 'Betakarításra vár',
    harvestStatusHarvesting: 'Betakarítás alatt',
    harvestStatusHarvested: 'Betakarítva',
    parcelNoName: '(névtelen)',
    parcelAreaUnit: '{area} ha',
    parcelViewOnMapA11y: 'Megtekintés a térképen',
    parcelAssignFarmA11y: 'Gazdaság hozzárendelése',
    createModalTitle: 'Új gazdaság',
    inputLabelFarmName: 'Gazdaság neve',
    placeholderFarmName: 'pl. Duna-gazdaság',
    inputLabelPhone: 'Telefon',
    placeholderPhone: 'pl. 0722 123 456',
    inputLabelEntityType: 'Jogi forma',
    inputLabelCui: 'CUI',
    placeholderCui: 'pl. RO12345678 (opcionális)',
    inputLabelApiaCode: 'RO APIA-kód',
    placeholderApiaCode: 'Gazdaság APIA-kódja (opcionális)',
    inputLabelAddress: 'Cím',
    placeholderAddress: 'Cím (opcionális)',
    createModalCancelButton: 'Mégse',
    createModalSaveButton: 'Gazdaság létrehozása',
    errorTitle: 'Hiba',
    errorNameRequired: 'A gazdaság neve kötelező.',
    errorPhoneRequired: 'A telefonszám kötelező.',
    errorCreateFailed: 'Nem sikerült létrehozni a gazdaságot. Kérjük, próbálja újra.',
  },

  geofenceMap: {
    bannerDrawDisabled: 'A táblák rajzolása ki van kapcsolva az Ön szervezeténél.',
    bannerIdle: 'Koppintson egy gombra tábla vagy raktár hozzáadásához',
    bannerFirstPoint:
      'Állítsa a jelölőt az első pontra, majd koppintson a „Pont hozzáadása” gombra',
    bannerProgress: '{count}/3. pont — folytassa (minimum 3 pont szükséges)',
    bannerEnoughPoints: '{count} pont — koppintson a „Befejezés” gombra, vagy adjon hozzá többet',
    cancelDrawButton: 'Mégse',
    fabNewFieldLabel: 'Új tábla',
    fabNewFieldA11y: 'Új tábla hozzáadása',
    fabNewDepotLabel: 'Új raktár',
    fabNewDepotA11y: 'Új raktár hozzáadása',
    locateFabA11y: 'Saját helyzet középre igazítása',
    addPointButton: 'Pont hozzáadása',
    addPointA11y: 'Pont hozzáadása a térkép közepén',
    undoPointButton: 'Visszavonás',
    undoPointA11y: 'Utolsó pont törlése',
    finishPolygonButton: 'Befejezés',
    finishPolygonA11y: 'Sokszög befejezése',
    successParcelTitle: 'Siker',
    successParcelMessage: 'A tábla mentve, és szinkronizálódik, amint újra lesz kapcsolat.',
    errorParcelTitle: 'Hiba',
    errorParcelMessage: 'Nem sikerült menteni a táblát. Kérjük, próbálja újra.',
    successDepotTitle: 'Siker',
    successDepotMessage: 'A raktár mentve, és szinkronizálódik, amint újra lesz kapcsolat.',
    errorDepotTitle: 'Hiba',
    errorDepotMessage: 'Nem sikerült menteni a raktárt. Kérjük, próbálja újra.',
    locationPermissionTitle: 'Helyzet',
    locationPermissionMessage: 'Kérjük, engedélyezze a helymeghatározást.',
    locationErrorTitle: 'Hiba',
    locationErrorMessage: 'Nem sikerült meghatározni a helyzetét.',
  },

  geofenceOverlay: {
    entryConfirm: {
      loadAction: 'Rakodás indítása itt: {code}',
      truckAction: 'Érkezés megerősítése itt: {code}',
    },
    banner: {
      fieldEntry: 'Megkezdte a(z) {parcelName} táblát',
      truckApproaching: '{plate} kamion — a sofőr közeledik Önhöz',
    },
    fieldFallback: 'Tábla',
    notFinishedButton: 'Még nem fejeztem be',
    exitConfirm: {
      titlePrefix: 'Befejezte a(z)',
      titleSuffix: ' táblát',
      subtitle: 'Hány bálát termelt ezen a táblán?',
    },
    loaderExit: {
      titlePrefix: 'Befejezte a rakodást a(z)',
      titleSuffix: ' táblán',
      subtitle: 'Minden bála be lett bálázva és felrakodva?',
      confirmButton: 'Igen, befejeztem',
      shortageTitle: 'A tábla nincs teljesen felrakodva',
      shortageMessage:
        'Termelt {produced}, felrakodott {loaded}. Hiányzik {missing} bála. A tábla nyitva marad — egy adminisztrátor értesítést kapott.',
      acknowledgeButton: 'Rendben',
    },
  },

  numericPad: {
    backspaceA11y: 'Utolsó számjegy törlése',
    clearA11y: 'Összes törlése',
    digitA11y: 'Számjegy {key}',
  },

  inactivityAlarm: {
    title: 'A gép nem küldött helyadatot',
    body: '{elapsedLabel} óta nincs GPS-frissítés. Ellenőrizze, hogy aktív-e a GPS.',
  },

  tripTransition: {
    illegalTransition:
      'A(z) "{transition}" átmenet nem engedélyezett a(z) "{currentStatus}" állapotból.',
  },

  routing: {
    navigationOpenFailed: 'Nem sikerült megnyitni a navigációt',
  },

  shared: {
    offlineBanner: {
      noConnection: 'Nincs kapcsolat',
      message: 'Offline — a módosítások szinkronizálódnak, amint csatlakozik',
    },
    syncQueueBanner: {
      allSynced: 'Minden szinkronizálva',
      failedSingular: '1 nem szinkronizált bejegyzés — koppintson a részletekért',
      failedPlural: '{{count}} nem szinkronizált bejegyzés — koppintson a részletekért',
      pendingSingular: '1 bejegyzés függőben',
      pendingPlural: '{{count}} bejegyzés függőben',
      syncing: 'szinkronizálás…',
      tapForDetails: 'Koppintson a részletekért.',
    },
    connectionStatusBadge: {
      online: 'Online',
      offline: 'Offline',
      a11yConnected: 'Kapcsolódva az internethez',
      a11yDisconnected: 'Nincs kapcsolat',
    },
    alertBanner: {
      a11yWarning: 'Figyelmeztetés',
      a11yError: 'Hiba',
      dismiss: 'Riasztás elvetése',
    },
    confirmCountdown: {
      executesIn: 'végrehajtás:',
      cancel: 'Mégse',
      cancelA11y: 'Művelet megszakítása',
    },
    problemReportModal: {
      title: 'Probléma jelentése',
      placeholder: 'Írja le a technikai problémát…',
      validationEmpty: 'Kérjük, írja le a problémát.',
      alertTitle: 'Technikai probléma',
      errorMessage: 'Hiba történt. Kérjük, próbálja újra.',
      submit: 'Küldés',
      cancel: 'Mégse',
      successMessage: 'A probléma sikeresen jelentve!',
    },
    taskList: {
      noTasks: 'Ma nincs hozzárendelt feladat.',
      sectionTitle: 'Mai feladatok',
      statusAvailable: 'Elérhető',
      statusInProgress: 'Folyamatban',
      statusDone: 'Kész',
      priorityUrgent: 'Sürgős',
      priorityHigh: 'Magas prioritás',
      fallbackLabel: '{{order}}. feladat',
    },
    tripProgress: {
      planned: 'Tervezett',
      loading: 'Rakodás alatt',
      loaded: 'Felrakodva',
      inTransit: 'Úton',
      arrived: 'Megérkezett',
      delivering: 'Kirakodás alatt',
      delivered: 'Leszállítva',
      completed: 'Lezárva',
    },
    undoToast: {
      undoButton: 'Visszavonás',
      a11yUndo: 'Bejegyzés visszavonása',
    },
    activeFieldCard: {
      sectionLabel: 'Aktív tábla',
      depotSectionLabel: 'Aktív raktár',
      depotTag: 'Raktár',
      loading: 'Betöltés…',
      openFieldA11y: 'Tábla részleteinek megnyitása',
      assignedField: 'Hozzárendelt tábla',
      presenceInside: 'Ön a táblán van',
      presenceOutsideWithDistance: '{{distance}} m a táblától',
      presenceOutside: 'Menjen a táblára',
      presenceUnknown: 'Pozíció ellenőrzése…',
      presenceUnverifiable: 'Pozíció nincs ellenőrizve (offline)',
      presenceNoGeometry: 'A tábla körvonala nincs eltárolva',
      tapForDetails: 'koppintson a részletekért',
      gpsNoDetect: 'GPS — Ön nincs érzékelve a táblán',
      noFieldAssigned: 'Nincs hozzárendelt tábla',
      helpUnavailable: 'Kérje meg a diszpécsert, hogy rendeljen Önhöz egy táblát mára.',
      helpGpsError:
        'Menjen a táblához, amelyen dolgozik, és koppintson a „GPS újra” gombra. A táblát a rendszer automatikusan felismeri a helyzet alapján — kézzel nem választható ki.',
      candidatesTitle: 'Az Önhöz rendelt táblák:',
      openParcelA11y: '{{name}} részleteinek megnyitása',
      parcelFallback: 'Tábla',
      retryGps: 'GPS újra',
      outlinesMissing: 'A táblák körvonalai nincsenek letöltve',
      helpMissingGeometry:
        'Ezen a telefonon még nincsenek letöltve a táblái körvonalai, így a pozíciója nem párosítható egyikhez sem. Töltse le őket — utána a tábla a szokásos módon automatikusan felismerésre kerül.',
      downloadOutlines: 'Körvonalak letöltése',
      downloadingOutlines: 'Letöltés…',
    },
    pendingTransitionBadge: {
      a11y: 'Átmenet szinkronizálásra vár',
      label: 'újracsatlakozáskor elküldve',
      failedA11y: 'Az átmenet szinkronizálása sikertelen, koppintson az újrapróbálkozáshoz',
      failedLabel: 'szinkronizálás sikertelen — koppintson az újrapróbálkozáshoz',
    },
    syncStatusIndicator: {
      syncing: 'Szinkronizálás folyamatban',
      pendingA11y: '{{count}} művelet a szinkronizálási sorban',
      synced: 'Szinkronizálva',
    },
    appHeader: {
      title: 'StrawBoss',
    },
    qrScanner: {
      defaultInstruction: 'QR-kód beolvasása',
    },
    photoCapture: {
      retake: 'Fénykép újra',
      noPhoto: 'Nincs fénykép készítve',
      takePhoto: 'Fénykép készítése',
    },
    avatarPicker: {
      permission: {
        title: 'Engedély szükséges',
        camera: 'Fénykép készítéséhez engedélyeznie kell a kamera használatát.',
        gallery: 'Fénykép kiválasztásához engedélyeznie kell a galéria elérését.',
      },
      upload: {
        failedTitle: 'A feltöltés sikertelen',
        failedDefault: 'Nem sikerült feltölteni a fényképet. Kérjük, próbálja újra.',
      },
      offline: {
        title: 'Ön offline van',
        message: 'Csatlakozzon az internethez a profilkép módosításához.',
      },
      sheet: {
        title: 'Profilkép',
        subtitle: 'Válasszon forrást',
        takePhoto: 'Fénykép készítése',
        chooseFromGallery: 'Kiválasztás a galériából',
        cancel: 'Mégse',
      },
      accessibilityLabel: 'Profilkép módosítása',
    },
    consumableTypeSelector: {
      diesel: 'Gázolaj',
      twine: 'Zsineg',
    },
  },

  delivery: {
    cmr: {
      title: 'CMR megerősítés',
      row: {
        trip: 'Fuvar',
        destination: 'Célállomás',
        locality: 'Település',
        bales: 'Bálák',
        grossWeight: 'Bruttó tömeg',
        tare: 'Önsúly',
        netWeight: 'Nettó tömeg',
        notWeighed: 'Nincs mérve',
        receiver: 'Átvevő',
      },
      action: {
        confirm: 'Leszállítás megerősítése',
        back: 'Vissza',
      },
      countdownActionLabel: 'CMR megerősítés',
    },
    enhancedFlow: {
      step: {
        weighing: 'Mérés',
        confirmation: 'Leszállítás megerősítése',
      },
      receiverFallback: 'Átvevő',
      deliverWithoutWeighing: {
        action: 'Leszállítás mérés nélkül',
        confirmTitle: 'Leszállítás mérés nélkül?',
        confirmMessage:
          'Csak akkor használja, ha a raktárban nincs működő mérleg. A fuvar tömeg nélkül kerül rögzítésre.',
        confirmAction: 'Igen, leszállítás mérés nélkül',
      },
      operatorWait: {
        title: 'Raktári megerősítésre várakozás',
        confirmedTitle: 'A raktáros megerősítette a leszállítást',
        pendingTitle: 'A leszállítást a raktáros erősíti meg',
        confirmedSubtitle: 'A raktáros megerősített {count} bálát.',
        pendingSubtitle:
          'Megerősítésre várakozás. Nem kell tömeget vagy aláírást megadnia — ezt a raktáros teszi meg.',
        unloadingTitle: 'Éppen kirakodás alatt',
        unloadingSubtitle: 'A kezelő elkezdte a kirakodást: {time}.',
        callOperator: 'Hívás',
        confirmedByDepot: 'raktár által megerősítve',
      },
      error: {
        title: 'Hiba',
        confirmFailed: 'Nem sikerült megerősíteni a leszállítást.',
      },
    },
    weightInput: {
      grossLabel: 'Bruttó (mért)',
      tareLabel: 'Önsúly (üres kamion)',
      netLabel: 'Nettó',
      tareOverGrossError: 'Az önsúly nem lehet nagyobb, mint a bruttó tömeg.',
      editingHint: 'Szerkesztés: {field}',
      editingHint_gross: 'Bruttó',
      editingHint_tare: 'Önsúly',
      action: {
        continue: 'Tovább',
      },
    },
  },

  production: {
    balerEntry: {
      crop: {
        grau: 'Búza',
        orz: 'Árpa',
        rapita: 'Repce',
        planteNutret: 'Takarmánynövény',
      },
      defaultLabel: 'Bálázás kezdése itt: {parcelCode}',
    },
    fieldNumpad: {
      todayLabel: 'Ma',
      balesUnit: 'bála',
      displayLabel: 'bála',
      taskParcelFallback: 'Kijelölt tábla',
      accessibility: {
        deleteLastDigit: 'Utolsó számjegy törlése',
        clearAll: 'Összes törlése',
        saveProduction: 'Termelés mentése',
      },
      toast: {
        saved: 'Rögzítve — {count} bála',
      },
      saveButton: {
        saving: 'Mentés…',
        label: 'MENTÉS',
      },
      error: {
        title: 'Hiba',
        saveFailed: 'Nem sikerült menteni a termelést',
      },
    },
    harvestFinish: {
      partial: 'Részben betakarítva',
      total: 'Teljesen betakarítva',
    },
    numpad: {
      parcelLabel: 'Tábla',
      displayLabel: 'bála',
      parcelSource: {
        gps: 'GPS alapján felismerve',
        task: 'A mai terv alapján',
      },
      gps: {
        loading: 'Helyzet meghatározása…',
        denied: 'GPS megtagadva — adja meg a helymeghatározási engedélyt',
        unavailable: 'GPS nem elérhető — próbálja újra a táblán',
        outsideParcels: 'A kijelölt táblákon kívül — menjen közelebb a táblához',
        detecting: 'Tábla felismerése GPS alapján…',
        nearField: 'Közel a táblához ({distance} m a szélétől)',
        outlinesMissing: 'A táblák körvonalai nincsenek letöltve erre a telefonra',
        noAssignment: 'Ma nincs Önhöz rendelt tábla',
      },
      noParcel: 'Nem tartózkodik egyetlen kijelölt táblán sem',
      loadingParcels: 'Táblák betöltése…',
      // Parcels now come from the offline-first cache and no longer fail to
      // load, so this key is no longer a live error string — kept for any
      // stale reference, superseded by `parcelsFromCache`.
      parcelsError: 'Nem sikerült betölteni a táblákat. Ellenőrizze a kapcsolatot.',
      parcelsFromCache: 'A mai terv alapján (offline)',
      accessibility: {
        deleteLastDigit: 'Utolsó számjegy törlése',
        clearAll: 'Összes törlése',
      },
      duplicateModal: {
        title: 'Termelés már rögzítve',
        message:
          'Ezen a táblán már rögzített ma {total} bálát ({minutes} perccel ezelőtt). Folytatja új bejegyzéssel?',
        confirm: 'Igen, folytatás',
        cancel: 'Mégse',
      },
      saveButton: {
        saving: 'Mentés…',
        label: 'TERMELÉS MENTÉSE',
      },
      toast: {
        saved: 'Rögzítve — {count} bála',
      },
      error: {
        title: 'Hiba',
        saveFailed: 'Nem sikerült menteni a termelést',
      },
    },
  },

  stats: {
    operator: {
      balesProduced: 'Ma termelt bálák',
      balesTransported: 'Ma szállított bálák',
      balesLoaded: 'Ma rakodott bálák',
      fuel: 'Ma tankolt gázolaj',
      twine: 'Ma felhasznált zsineg',
      error: {
        loadFailed: 'Nem sikerült betölteni a statisztikát',
      },
    },
  },

  activity: {
    todayCard: {
      headerTitle: 'Mai tevékenységem',
      accessibility: {
        expand: 'Mai tevékenység kibontása',
        collapse: 'Mai tevékenység összecsukása',
        pendingCount: '{count} nincs szinkronizálva',
      },
      syncStatus: {
        synced: 'szinkronizálva',
        pending: 'függőben',
        failed: 'sikertelen',
      },
      empty: {
        text: 'Ma nincs bejegyzés.',
        subtext: 'A termelések, tankolások és rakodások mentés után itt jelennek meg.',
      },
      retry: 'Újra',
    },
  },

  consumables: {
    flow: {
      twine: {
        title: 'Zsineg mennyisége (kg)',
        action: {
          save: 'Mentés',
          back: 'Vissza',
        },
      },
      typeSelector: {
        title: 'Fogyóeszköz típusa',
        action: {
          continue: 'Tovább',
        },
      },
      toast: {
        twine: 'Rögzítve — {qty} kg zsineg',
      },
      error: {
        title: 'Hiba',
        saveFailed: 'Nem sikerült menteni a fogyóeszközt',
      },
    },
  },

  fuel: {
    entryFlow: {
      step: {
        liters: 'Tankolt literek',
        stationPhoto: 'Töltőállomás fotója',
        confirm: 'Tankolás megerősítése',
      },
      liters: {
        subtitle: 'Hány litert tankolt?',
        action: {
          continue: 'Tovább',
          cancel: 'Mégse',
        },
      },
      stationPhoto: {
        subtitle: 'Fényképezze le a töltőállomást. Bizonylat NEM szükséges.',
        captureLabel: 'Állomás fotója',
        action: {
          continue: 'Tovább',
          back: 'Vissza',
        },
      },
      confirm: {
        row: {
          liters: 'Liter',
          photo: 'Fotó',
        },
        action: {
          save: 'Mentés',
          back: 'Vissza',
        },
      },
      toast: {
        saved: 'Rögzítve — {liters} L üzemanyag',
      },
      error: {
        title: 'Hiba',
        saveFailed: 'Nem sikerült menteni a tankolást',
        noMachine:
          'Nincs Önhöz rendelt gép, ezért ez a tankolás nem rögzíthető. Kérje meg a diszpécsert, hogy rendelje hozzá a gépét, majd próbálja újra.',
      },
    },
  },

  profile: {
    role: {
      driver: 'Sofőr',
      loaderOperator: 'Rakodógép-kezelő',
      balerOperator: 'Bálázókezelő',
      dispatcher: 'Diszpécser',
      admin: 'Adminisztrátor',
      geofenceMaker: 'Geokerítés-szerkesztő',
    },
    devMode: {
      syncActivated: {
        title: 'Szinkronizálás bekapcsolva',
        message: 'A szinkronizálás-vezérlő az alkalmazás bezárásáig látható marad.',
      },
    },
    error: {
      loadProfile: 'Nem sikerült betölteni a profiladatokat',
    },
    sync: {
      cardTitle: 'Szinkronizálás',
      network: 'Hálózat',
      online: 'Online',
      offline: 'Offline',
      inQueue: 'Sorban áll',
      failedHint:
        'Az utolsó szinkronizálás {count} {item} esetében sikertelen volt — használja a lenti gombot.',
      failedHint_record_singular: 'bejegyzés',
      failedHint_record_plural: 'bejegyzés',
      lastSync: 'Utolsó szinkronizálás',
      syncing: 'Szinkronizálás…',
      syncNow: 'Szinkronizálás most',
      retryFailed: 'Sikertelen bejegyzések újrapróbálása',
      clearQueue: 'Sikertelen sor törlése',
    },
    machine: {
      cardTitle: 'Hozzárendelt gép',
      none: 'Nincs hozzárendelt gép',
      loadError: 'Nem sikerült betölteni a gépet',
    },
    stats: {
      sectionTitle: 'Saját statisztikám',
    },
    signature: {
      cardTitle: 'Aláírásminta',
      noSpecimen: 'Még nincs aláírásmintája.',
      changeSpecimen: 'Aláírásminta módosítása',
      createSpecimen: 'Aláírásminta létrehozása',
      accessibilityLabel: 'Aláírásminta módosítása',
    },
    dailyReport: 'Napi PDF-jelentés',
    trackingSetup: 'Nyomkövetés beállítása',
    trackingSetup_accessibilityLabel: 'Folyamatos nyomkövetés beállítása',
    display: {
      cardTitle: 'Megjelenítés',
      highContrast: {
        label: 'Napfénymód',
        hint: 'Fehér háttér, fekete szöveg — jobban olvasható napfényben',
        accessibilityLabel: 'Nagy kontrasztú mód bekapcsolása',
      },
    },
    deviceAdmin: {
      cardTitle: 'Eszközkezelés',
      hint: 'Felügyelt telefon (Device Owner). A feloldás megszünteti a védelmet, és lehetővé teszi az alkalmazás eltávolítását.',
      release: 'Eszköz felszabadítása',
    },
    logout: 'Kijelentkezés',
    version: 'Verzió {version}',
    modal: {
      releaseDevice: {
        title: 'Eszköz felszabadítása',
        message:
          'Megszünteti a Device Owner védelmet: az alkalmazás újra leállítható és eltávolítható lesz. Csak akkor használja, ha ezt a telefont kivonja a használatból. Folytatja?',
        confirm: 'Felszabadítás',
        cancel: 'Mégse',
        successTitle: 'Kész',
        successMessage: 'Az eszköz felszabadult. Az alkalmazás mostantól eltávolítható.',
        errorTitle: 'Hiba',
        errorMessage: 'Nem sikerült felszabadítani az eszközt.',
      },
      clearQueue: {
        title: 'Sikertelen sor törlése',
        message:
          'A sikertelen bejegyzések véglegesen törlődnek a telefonról. A szerverre már elküldött bejegyzések változatlanok maradnak. Folytatja?',
        confirm: 'Törlés',
        cancel: 'Mégse',
        successTitle: 'Kész',
        successDeleted: '{count} bejegyzés törölve a sorból.',
        successEmpty: 'Nem voltak sikertelen bejegyzések.',
        errorTitle: 'Hiba',
        errorDefault: 'Nem sikerült törölni a sort.',
      },
      logoutPending: {
        title: 'Nem szinkronizált bejegyzések',
        message:
          '{count} nem szinkronizált bejegyzés van ezen a telefonon. Ha most kijelentkezik, ezek véglegesen elvesznek. Szinkronizáljon előbb, vagy jelentkezzen ki mindenképp.',
        confirm: 'Kijelentkezés mindenképp',
        syncNow: 'Szinkronizálás most',
      },
    },
  },

  geofenceMaker: {
    assignFarm: {
      title: 'Gazdaság hozzárendelése',
      loading: 'Gazdaságok betöltése…',
      empty: 'Nincs elérhető gazdaság. Hozzon létre egyet a Gazdaságok fülön.',
      error: {
        title: 'Hiba',
        message: 'Nem sikerült hozzárendelni a gazdaságot. Kérjük, próbálja újra.',
      },
    },
    createDeposit: {
      title: 'Új raktár',
      label: {
        code: 'Raktár kódja',
        name: 'Raktár neve',
        address: 'Cím',
        contactName: 'Kapcsolattartó',
        contactPhone: 'Kapcsolattartó telefonszáma',
        isDefault: 'Alapértelmezett raktár',
      },
      placeholder: {
        code: 'pl. DEP-01',
        name: 'pl. Központi raktár',
        address: 'Utca, város, megye',
        contactName: 'Teljes név (opcionális)',
        contactPhone: 'pl. 0722 123 456 (opcionális)',
      },
      hint: {
        isDefault: 'Automatikusan kiválasztott raktár a szállításokhoz',
      },
      error: {
        codeRequired: 'A raktár kódja kötelező.',
        nameRequired: 'A raktár neve kötelező.',
        addressRequired: 'A raktár címe kötelező.',
      },
      cancel: 'Mégse',
      save: 'Raktár mentése',
    },
    createParcel: {
      title: 'Új tábla',
      label: {
        name: 'Tábla neve',
        farm: 'Gazdaság',
        crop: 'Termény',
        municipality: 'Település',
        notes: 'Megjegyzések',
      },
      placeholder: {
        name: 'pl. Északi tábla 12',
        farm: 'Válasszon gazdaságot (opcionális)',
        crop: 'Válasszon terményt (opcionális)',
        municipality: 'Automatikusan meghatározva a helyzet alapján',
        notes: 'További megjegyzések (opcionális)',
      },
      error: {
        nameRequired: 'A tábla neve kötelező.',
      },
      cancel: 'Mégse',
      save: 'Tábla mentése',
      selectFarm: {
        title: 'Gazdaság kiválasztása',
        back: 'Vissza',
        empty: 'Még nincs létrehozott gazdaság.',
        addNew: 'Új gazdaság hozzáadása',
      },
      selectCrop: {
        title: 'Termény kiválasztása',
        back: 'Vissza',
      },
      cropLabel: {
        grau: 'Búza',
        orz: 'Árpa',
        rapita: 'Repce',
        planteNutret: 'Takarmánynövény',
        altele: 'Egyéb',
      },
      createFarm: {
        title: 'Új gazdaság',
        back: 'Vissza',
        label: {
          name: 'Gazdaság neve',
          phone: 'Telefon',
          entityType: 'Jogi forma',
          cui: 'CUI',
          apiaCode: 'RO APIA-kód',
          address: 'Cím',
        },
        placeholder: {
          name: 'pl. Ionescu-gazdaság',
          phone: 'pl. 0722 123 456',
          cui: 'pl. RO12345678 (opcionális)',
          apiaCode: 'Gazdaság APIA-kódja (opcionális)',
          address: 'pl. Deta, Timiș (opcionális)',
        },
        entityType: {
          juridica: 'Jogi személy',
          fizica: 'Természetes személy',
        },
        error: {
          nameRequired: 'A gazdaság neve kötelező.',
          phoneRequired: 'A telefonszám kötelező.',
          createFailed: 'Nem sikerült létrehozni a gazdaságot. Kérjük, próbálja újra.',
        },
        cancel: 'Mégse',
        submit: 'Gazdaság létrehozása',
      },
    },
    geofenceAssign: {
      title: 'Megrajzolt terület hozzárendelése',
      toggle: {
        parcel: 'Tábla',
        deposit: 'Raktár',
      },
      hint: {
        selectParcel: 'Válasszon táblát:',
        selectDeposit: 'Válasszon raktárt:',
      },
      empty: {
        parcel: 'Nincs elérhető tábla.',
        deposit: 'Nincs elérhető raktár.',
      },
      cancel: 'Mégse',
      save: 'Mentés',
    },
  },

  map: {
    geofenceEditor: {
      loadingMap: 'Térkép betöltése…',
      error: 'Nem sikerült betölteni a térképet. Próbálja újra.',
      retry: 'Újra',
    },
    parcelSheet: {
      harvestStatus: {
        planned: 'Tervezett',
        toHarvest: 'Betakarításra vár',
        harvesting: 'Betakarítás alatt',
        harvested: 'Betakarítva',
      },
      routeSummaryLabel: 'Útvonal a térképen',
      routeSummary: {
        straightLine: '{distance} km (egyenes vonalban)',
      },
      startGoogleMaps: 'Indítás Google Térképen',
      previewRoute: 'Útvonal előnézete',
      close: 'Bezárás',
      noCoordsWarning:
        'A célállomás koordinátái nem érhetők el ehhez a kiválasztáshoz. Az útvonal előnézete és a navigáció nem nyitható meg.',
      info: {
        area: 'Terület',
        status: 'Státusz',
        municipality: 'Település',
      },
      enableLocationHint: 'Engedélyezze a helymeghatározást az útvonal kiszámításához a térképen.',
      error: {
        googleMaps: {
          title: 'Hiba',
          message: 'Nem sikerült megnyitni a Google Térképet vagy a navigációt.',
        },
      },
    },
    mapScreen: {
      offlineBanner: 'Táblák a helyi gyorsítótárból (offline)',
      legendAssigned: 'Az Ön mai táblái',
      reset: 'Visszaállítás',
      resetAccessibilityLabel: 'Térkép visszaállítása',
      recenterAccessibilityLabel: 'Saját helyzet középre igazítása',
      location: {
        title: 'Helyzet',
        permissionMessage:
          'Engedélyezze a helymeghatározást, hogy megjelenjen a saját helyzete a térképen.',
      },
      error: {
        locationTitle: 'Hiba',
        locationMessage: 'Nem sikerült meghatározni a jelenlegi helyzetet.',
        noCurrentLocation: 'A jelenlegi helyzet nem érhető el.',
        noDestinationCoords: 'A célállomás koordinátái nem érhetők el.',
      },
      routeInfo: {
        title: 'Információ',
        offlineMessage:
          'A részletes útvonalhoz internetkapcsolat szükséges. Egyenes vonal jelenik meg.',
      },
    },
  },

  parcel: {
    detail: {
      screenTitle: 'Tábla',
      error: {
        cannotLoad: {
          title: 'Nem sikerült betölteni a táblát',
          subtitle: 'Ellenőrizze az internetkapcsolatot, és próbálja újra.',
          back: 'Vissza',
        },
      },
      bales: {
        label: 'Bálák a táblán',
        sub: 'termelve {produced} · felrakodva {loaded}',
        unavailableOffline: 'offline nem elérhető',
      },
      crop: {
        label: 'Termény',
        undefined: 'nincs megadva',
      },
      cropLabel: {
        grau: 'Búza',
        orz: 'Árpa',
        rapita: 'Repce',
        planteNutret: 'Takarmánynövény',
      },
      harvestStatus: {
        planned: 'Tervezett',
        toHarvest: 'Betakarításra vár',
        harvesting: 'Betakarítás alatt',
        partialHarvested: 'Részben betakarítva',
        harvested: 'Betakarítva',
        inLoading: 'Betakarítás alatt',
        loaded: 'Betakarítva',
        completed: 'Lezárva',
      },
      location: {
        municipality: 'Település',
        address: 'Cím',
      },
      notes: {
        label: 'Megjegyzések',
      },
      navigate: 'Navigálás oda',
      openOnMap: 'Megnyitás térképen',
      navigate_error: 'Nem sikerült megnyitni a navigációs alkalmazást.',
      navigate_alertTitle: 'Navigáció',
    },
  },
} as const satisfies CatalogShape<TranslationKeys>;
