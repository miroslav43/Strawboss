# Propuneri de îmbunătățire — StrawBoss Mobile & Web

> **Data analizei:** 2026-05-19
> **Scop:** propuneri de feature noi (UI/UX + logică/funcționalitate) și un backlog de
> bug-uri/îmbunătățiri prioritizate. Accentul principal este pe aplicația **mobile**.
> **Status:** document de planificare — nimic din cod nu a fost modificat.

---

## Cuprins

1. [Cum a fost făcută analiza](#cum-a-fost-făcută-analiza)
2. [Rezumat executiv](#rezumat-executiv)
3. [Partea I — Mobile: propuneri de feature noi](#partea-i--mobile-propuneri-de-feature-noi)
4. [Partea II — Mobile: bug-uri și îmbunătățiri prioritizate](#partea-ii--mobile-bug-uri-și-îmbunătățiri-prioritizate)
5. [Partea III — Web Admin: propuneri de feature noi](#partea-iii--web-admin-propuneri-de-feature-noi)
6. [Partea IV — Web Admin: bug-uri și îmbunătățiri prioritizate](#partea-iv--web-admin-bug-uri-și-îmbunătățiri-prioritizate)
7. [Partea V — Foaie de parcurs sugerată](#partea-v--foaie-de-parcurs-sugerată)

---

## Cum a fost făcută analiza

S-au citit în profunzime:

- **Mobile (`apps/mobile/`)** — toate ecranele din `app/`, componentele din `src/components/`
  (ui, shared, features, map, geofence-maker), întregul `src/sync/`, `src/db/`, `src/hooks/`,
  `src/lib/`, `src/stores/`, fluxurile `driver-ops/` și `loader-ops/`.
- **Web (`apps/admin-web/`)** — paginile din `src/app/[slug]/(dashboard)/`, componentele
  `features/` și `shared/`, `src/lib/` (realtime, i18n), cataloagele de traduceri.

Severitățile sunt clasificate: **🔴 Mare** (impact funcțional, pierdere de date, blocaj
utilizator), **🟡 Medie** (UX deficitar, risc de eroare, datorie tehnică), **🟢 Mică**
(cosmetic, polish).

---

## Rezumat executiv

**Aplicația mobile este solidă ca arhitectură** (offline-first, SQLite + sync queue,
state machine pentru trip), dar are trei categorii de slăbiciuni majore:

1. **Offline-first incomplet.** Paradoxal pentru o aplicație „offline-first", cele mai
   importante acțiuni ale șoferului — `depart`, `arrive`, fluxul de livrare — sunt
   apeluri API directe, fără fallback offline. Un șofer fără semnal **nu poate pleca,
   nu poate sosi și nu poate finaliza o livrare**. Aceasta este problema #1.

2. **Prevenirea erorilor de teren e slabă.** Înregistrările (producție, alimentare,
   consumabile) se salvează instant, fără undo, fără detecție de duplicate, fără
   confirmare pentru acțiuni ireversibile. Un `500` tastat în loc de `50` ajunge direct
   în reconciliere.

3. **Ergonomie de câmp neuniformă.** Stringuri în engleză pe ecrane cheie, contrast
   insuficient pentru lumină de soare, lipsă feedback haptic, fluxuri multi-pas fără
   indicator de progres.

În plus, există **cod de debug lăsat în producție** (`debug-ingest.ts` face cereri de
rețea la `127.0.0.1` la fiecare eveniment) și un **bug de boot** care deschide UI-ul
chiar dacă baza de date locală a eșuat.

**Aplicația web** este într-o stare bună funcțional, dar are o **acoperire i18n
incompletă** (multe componente nu folosesc deloc `t()`), un **link de alertă rupt**
(404 din cauza lipsei prefixului de organizație) și **realtime incomplet** (pozițiile
mașinilor pe hartă nu se actualizează live).

---

# Partea I — Mobile: propuneri de feature noi

18 propuneri, grupate pe 6 teme. Fiecare are: **Problema**, **Soluția**, **Implementare**,
**Efort** (S = ore, M = 1-3 zile, L = >3 zile), **Impact**.

---

## Tema 1 — Robustețe offline (prioritate maximă)

### FM-1 · Tranziții de cursă complet offline

**Problema.** Fluxurile critice ale șoferului ocolesc coada de sync:
- `app/driver-ops/departure-flow.tsx:48` — `depart` este apel API direct
- `app/driver-ops/arrival-flow.tsx:45` — `arrive` este apel API direct
- `app/trip/[tripId].tsx:84` — `set-destination` este apel API direct
- `src/components/features/delivery/EnhancedDeliveryFlow.tsx:103-113` — `start-delivery`,
  `confirm-delivery`, `complete` sunt trei apeluri API consecutive

Dacă rețeaua cade, șoferul vede o eroare și **rămâne blocat**. Mai grav: în fluxul de
livrare, dacă rețeaua cade între `confirm-delivery` și `complete`, cursa rămâne în starea
`delivered` pe server, iar `complete` (apelat „strict", linia 110) va eșua la retry
pentru că tripul e deja `delivered`.

**Soluția.** Toate cele zece tranziții ale state machine-ului trebuie să treacă prin
`sync_queue` ca operații `trips` de tip `transition`, cu execuție amânată. La
reconectare, sync-ul le aplică în ordine (`created_at ASC`). UI-ul reflectă imediat
starea nouă local (optimistic), iar un badge „va fi trimis la reconectare" semnalează
operațiile încă nesincronizate.

**Implementare.**
- Adaugă în `src/sync/push.ts` suport pentru entitate `trips` cu `action: 'transition'`
  și `payload: { transition, ...metadata }`; serverul are deja endpoint-uri idempotente.
- Salvează local pasul curent al fluxului de livrare (ex. coloană nouă pe `trips` locale
  sau o tabelă `trip_flow_progress`) ca să poți relua exact de unde a rămas după crash.
- Înlocuiește apelurile directe cu `tripsRepo.applyTransitionLocally()` + `enqueue()`.
- Aplică `getAvailableTransitions()` din `@strawboss/domain` și **local**, pentru a valida
  înainte de a pune în coadă.

**Efort:** L · **Impact:** 🔴 Mare — transformă fundamental fiabilitatea pentru șoferi.

---

### FM-2 · Indicator de coadă sync vizibil + ecran „Date în așteptare"

**Problema.** `ConnectionStatusBadge` arată doar online/offline. Operatorul **nu știe**
câte înregistrări sunt nesincronizate, dacă sync-ul rulează, sau dacă ceva a eșuat. La
finalul zilei nu are nicio confirmare că munca lui a ajuns pe server.

**Soluția.**
1. Un **banner discret persistent** jos pe ecranele principale:
   `„3 înregistrări în așteptare · sincronizez…"` cu indicator animat, sau
   `„Tot sincronizat ✓"` când coada e goală.
2. Un **ecran „Date în așteptare"** (extinde `app/(tabs)/sync.tsx`) care listează fiecare
   intrare din `sync_queue` cu: tip, timestamp, status (`pending`/`failed`), număr de
   reîncercări, și un buton „Reîncearcă acum". Pentru intrările `failed`, afișează mesajul
   de eroare al serverului.

**Implementare.**
- Hook nou `useSyncQueueStatus()` peste `sync-queue-repo.ts` (count pe status).
- Componentă `SyncQueueBanner` montată în layout-urile de rol.
- Refolosește `SyncStatusIndicator.tsx` existent ca punct de plecare.

**Efort:** M · **Impact:** 🔴 Mare — încredere și diagnostic pentru operatorii de teren.

---

### FM-3 · Reconciliere locală cu avertizare la divergență

**Problema.** `src/sync/conflict.ts:21-38` rezolvă mereu „server wins", silențios. Dacă un
loader înregistrează offline `40` de baloți, iar la sync serverul returnează `52` (alt
loader a mai adăugat pe același trip), valoarea locală e suprascrisă **fără ca operatorul
să afle**. La fel pentru `parcel_id`, `notes` editate local.

**Soluția.** La pull, când serverul returnează o valoare diferită de cea locală pentru un
câmp editabil de utilizator, în loc de suprascriere tăcută:
- afișează o **notificare locală** — `„Contorul de baloți a fost actualizat de pe server:
  40 → 52"`;
- pentru câmpuri text (notes), compară `updated_at` și păstrează versiunea mai nouă.

**Implementare.** Extinde `resolveConflict()` să returneze `{ winner, changedFields }` și
emite `Notifications.scheduleNotificationAsync` pentru câmpurile divergente importante.

**Efort:** M · **Impact:** 🟡 Medie — elimină confuzia „de ce văd alt număr".

---

## Tema 2 — Prevenirea erorilor de teren

### FM-4 · „Undo" de 5 secunde pe înregistrări

**Problema.** `ProductionNumpad`, `FuelEntryFlow`, `ConsumableFlow` salvează imediat în
SQLite și pun în coada de sync. O cifră greșită (`500` în loc de `50`) intră direct în
reconciliere și trebuie corectată ulterior din dashboard.

**Soluția.** După salvare, un **toast cu buton „Anulează"** vizibil 5 secunde. Cât timp
înregistrarea e încă `pending` în `sync_queue` (nu a fost trimisă), „Anulează" o șterge
din SQLite + din coadă. Dacă a fost deja sincronizată, butonul dispare.

**Implementare.** Hook `useUndoableSave()` care întoarce `{ save, lastSaved }`; toast cu
timer; verificare `sync-queue-repo` că intrarea e încă `pending` înainte de delete.

**Efort:** M · **Impact:** 🟡 Medie — reduce semnificativ erorile de tastare.

---

### FM-5 · Detecție de duplicate la înregistrare

**Problema.** Nu există nicio verificare locală împotriva dublei înregistrări. Un GPS
oscilant sau un dublu-tap accidental poate genera două `bale_load`-uri pentru același
`(truckId, parcelId)`, sau două producții pentru același `(parcelId, productionDate)`.

**Soluția.** Înainte de a salva, interoghează SQLite local:
- **Baloți:** dacă există un `bale_load` pe același `(truckId, parcelId)` în ultimele
  10 minute → avertisment: `„Ai înregistrat deja X baloți pe acest camion acum Y minute.
  Continui?"`.
- **Producție:** dacă există deja o producție pe `(parcelId, productionDate)` →
  avertisment similar, cu opțiunea de a edita în loc de a crea.

**Implementare.** Query-uri noi în `bale-loads-repo.ts` și `bale-productions-repo.ts`;
modal de confirmare înainte de `enqueue()`.

**Efort:** S-M · **Impact:** 🟡 Medie — atacă o sursă reală de date murdare.

---

### FM-6 · Confirmare cu countdown pentru acțiuni ireversibile

**Problema.** Plecarea dintr-un câmp, finalizarea livrării și confirmarea CMR sunt
ireversibile și modifică starea serverului. Se declanșează cu un singur tap, ușor de
apăsat din greșeală cu mănuși.

**Soluția.** Pentru aceste acțiuni, un pattern „undo countdown": după tap, un overlay de
3 secunde cu `„Plec în 3… 2… 1"` și buton mare „Anulează". Acțiunea se execută doar după
expirarea countdown-ului. (Mai puțin intruziv decât un PIN, dar la fel de eficient.)

**Implementare.** Componentă `ConfirmCountdown` refolosibilă; o folosesc fluxurile
`departure-flow`, `EnhancedDeliveryFlow` (pasul final), `CmrConfirmation`.

**Efort:** S · **Impact:** 🟡 Medie.

---

## Tema 3 — Ergonomie de câmp

### FM-7 · Mod „Câmp activ" pentru balotieră

**Problema.** Operatorul de balotieră introduce producție repetat, în câmp, cu telefonul
expus. Ecranul se poate stinge între înregistrări, iar tab bar-ul + header-ul cu
notificări ocupă spațiu și permit ieșiri accidentale din flux.

**Soluția.** Un toggle „Câmp activ" care:
- ține ecranul aprins (`expo-keep-awake`);
- afișează un layout minimal: doar numpad-ul mare + butonul „Salvează" + contorul zilei;
- ascunde tab bar-ul și header-ul; ieșire printr-un singur gest clar.

**Implementare.** Adaugă `expo-keep-awake`; o variantă de layout în `app/(baler)/production.tsx`
comutată de un flag din `dev-mode-store` → redenumit `ui-prefs-store`.

**Efort:** M · **Impact:** 🟡 Medie — direct util pentru cel mai repetitiv rol.

---

### FM-8 · Mod contrast ridicat pentru lumină de soare

**Problema.** Fundalul implicit `#F3DED8` cu text secundar `#8D6E63` (`colors.tertiary`)
dă un raport de contrast ~2.8:1 — sub minimul WCAG AA de 4.5:1. În amiaza de vară,
ecranele sunt greu de citit. Problema apare în zeci de locuri (driver index, loader index,
TaskList etc.).

**Soluția.** Un toggle în profil — „Mod lumină puternică" — care comută o temă cu fundal
alb pur, text negru, butoane cu margine solidă. Nu e nevoie de dark mode complet, doar un
al doilea set de tokens de contrast ridicat.

**Implementare.** Adaugă o variantă „highContrast" în `@strawboss/ui-tokens`; un
`ThemeProvider` ușor pe mobile; persistă alegerea în store.

**Efort:** M · **Impact:** 🟡 Medie — accesibilitate reală, cerere frecventă de teren.

---

### FM-9 · Feedback haptic pe acțiunile critice

**Problema.** `ProfileScreen.tsx:11` importă `Vibration` dar e folosit doar pentru
secvența dev-mode. Nu există feedback haptic la salvarea producției, confirmarea livrării,
plecare. În zgomot de utilaje, operatorul nu aude confirmarea sonoră.

**Soluția.** `Haptics.notificationAsync(Success)` din `expo-haptics` la finalizarea
acțiunilor de date; `Haptics.impactAsync(Light)` la apăsarea tastelor de numpad.

**Implementare.** Adaugă `expo-haptics`; cârlig în `showToast()` din `ProductionNumpad`,
în finalul fluxurilor de livrare/încărcare.

**Efort:** S · **Impact:** 🟢 Mică-Medie.

---

### FM-10 · Indicator de pași pentru fluxurile multi-pas

**Problema.** Fluxul de livrare are 5 pași (`EnhancedDeliveryFlow.tsx:28-36`), cel de
combustibil are 5 (`FuelEntryFlow`), dar singurul indiciu de progres e titlul din header.
Operatorul nu știe câți pași mai are.

**Soluția.** Un indicator orizontal de pași (puncte/segmente, similar `TripProgress.tsx`)
afișat pe fiecare ecran al fluxului, între header și conținut. Bonus: tranziție orizontală
animată între pași (slide-left/right).

**Implementare.** Componentă `StepIndicator` refolosibilă; integrată în toate cele trei
componente de flux.

**Efort:** S-M · **Impact:** 🟡 Medie.

---

## Tema 4 — Vizibilitate și valoare pentru operator

### FM-11 · Ecran „Activitatea mea azi" (offline-first)

**Problema.** Operatorul nu poate verifica rapid ce a înregistrat azi. Repo-urile au deja
`listByOperator()`, dar nu există niciun ecran care să afișeze istoricul local.

**Soluția.** Un card/ecran „Azi" care listează din SQLite (deci **funcționează offline**)
ultimele înregistrări ale utilizatorului — producții, alimentări, încărcări, consumabile —
fiecare cu timestamp și status de sync (`sincronizat ✓` / `în așteptare`). Operatorul
verifică înainte de a pleca acasă dacă a uitat ceva.

**Implementare.** Hook `useTodayActivity()` care unește `listByOperator()` din repo-urile
relevante, sortat după timp; card expandabil în ecranele de profil.

**Efort:** M · **Impact:** 🟡 Medie-Mare — vizibilitate concretă a propriei munci.

---

### FM-12 · Widget de cursă activă pe home-ul șoferului

**Problema.** Un șofer cu mai multe curse anterioare în listă trebuie să scroll-eze ca să
găsească cursa activă (`in_transit`, `arrived` etc.).

**Soluția.** Un card sticky în vârful listei, vizibil fără scroll, cu: starea curentă a
cursei active, sursa/destinația, acțiunea disponibilă (buton mare) și `TripProgress`.

**Implementare.** Filtrare a cursei active în `app/(driver)/index.tsx`; secțiune sticky
deasupra `FlatList`.

**Efort:** S-M · **Impact:** 🟡 Medie.

---

### FM-13 · Planificator zilnic offline cu hartă de parcele

**Problema.** Conturul GeoJSON al parcelelor nu e cachuit local pentru vizualizare. Pe
câmp, fără semnal, operatorul nu vede pe hartă unde trebuie să lucreze.

**Soluția.** La pull, stochează GeoJSON-ul parcelelor asignate în SQLite. Ecranul de hartă
desenează parcelele zilei și **din cache** — funcționează complet offline. Marchează
vizual parcela curentă / cea făcută.

**Implementare.** Coloană `geometry` (TEXT/JSON) pe tabela locală de task assignments sau
o tabelă `parcels` locală; `MapScreen` citește din cache când e offline.

**Efort:** M-L · **Impact:** 🟡 Medie.

---

### FM-14 · Raport zilnic PDF + partajare WhatsApp

**Problema.** Fermierii fără acces constant la dashboard-ul web nu au o sinteză a zilei.

**Soluția.** La finalul zilei, generează local un PDF: baloți produși, litri alimentați,
consumabile, curse efectuate. Buton de partajare → WhatsApp/email direct din aplicație.
(Există deja `WhatsAppLink.tsx`.)

**Implementare.** `expo-print` (`printToFileAsync`) + `expo-sharing`; șablon HTML din
datele locale.

**Efort:** M · **Impact:** 🟡 Medie.

---

## Tema 5 — GPS și monitorizare

### FM-15 · Tracking GPS adaptiv + remediere background iOS

**Problema.**
- `src/lib/location.ts:261` — `startBackgroundLocationTracking()` iese imediat pe iOS
  (`if (Platform.OS !== 'android') return;`). Pe iPhone, geofence-urile **nu funcționează**
  în background.
- `location.ts:283` — `Accuracy.High` la interval de 15s pentru un utilaj care merge cu
  5-10 km/h consumă baterie inutil.

**Soluția.**
1. Activează background location pe iOS (`UIBackgroundModes: location` + permisiuni
   „Always") sau, dacă iOS nu e suportat oficial, documentează explicit „Android-only".
2. Tracking adaptiv: detectează viteza — `>30 km/h` (drum) → rapoarte rare, `Balanced`;
   `<10 km/h` (câmp) → rapoarte dese, `High`. Economisește baterie și crește acuratețea
   geofence-ului acolo unde contează.

**Implementare.** Logică de adaptare a `accuracy`/`distanceInterval` în task-ul de
background pe baza ultimei viteze raportate.

**Efort:** M · **Impact:** 🔴 Mare pe iOS, 🟡 Medie pe Android (baterie).

---

### FM-16 · Alarme de inactivitate mașină

**Problema.** Nu există detecție pentru o mașină care s-a oprit din raportat (defecțiune,
abandon, oprire neplanificată).

**Soluția.** Dacă o mașină nu a raportat locație de >2 ore în intervalul de lucru
(07:00-19:00, configurabil), se generează o alertă către dispecer/supervizor. Logica se
poate face server-side (job BullMQ) și/sau local printr-un check în handler-ul de
`AppState` (există deja în `_layout.tsx`).

**Efort:** M · **Impact:** 🟡 Medie.

---

## Tema 6 — Onboarding și OCR

### FM-17 · Tutorial de onboarding per rol

**Problema.** Un utilizator nou cu un rol nou nu primește niciun ghidaj. Crește apelurile
de suport de pe teren.

**Soluția.** La prima autentificare per rol, 3-4 ecrane de tutorial cu capturi animate:
ce înseamnă task-urile zilei, cum se înregistrează producția/alimentarea, ce face
geofence-ul. Marcat în AsyncStorage ca `hasSeenOnboarding_${role}`.

**Efort:** M · **Impact:** 🟢 Mică-Medie.

---

### FM-18 · Flux OCR îmbunătățit cu preview live

**Problema.** `OcrPhotoCapture` e un pas separat, ușor de sărit. Dacă OCR-ul eșuează
(poză neclară), `scan()` întoarce `{}` fără niciun mesaj — operatorul vede un câmp gol și
nu înțelege de ce.

**Soluția.**
- Cameră ca pas primar pentru bonuri, cu overlay care evidențiază zona de citit.
- Afișează valoarea citită **în viewfinder**, înainte de confirmare, cu haptic la succes.
- Când `ocr.lines.length === 0`, mesaj explicit: `„Nu am putut citi bonul. Introdu
  manual."` (flag `ocrFailed` din `useOcrScan`).
- Reduce fluxul de alimentare de la 5 la 3 pași.

**Efort:** M · **Impact:** 🟡 Medie.

---

# Partea II — Mobile: bug-uri și îmbunătățiri prioritizate

### 🔴 Severitate mare

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| M1 | `debug-ingest.ts` lăsat în producție — face `fetch()` la `http://127.0.0.1:7683` la fiecare eveniment de auth/DB; sute de cereri eșuate silențios, consum rețea/baterie | `src/lib/debug-ingest.ts`, `app/_layout.tsx:33` + ~15 apeluri | Șterge fișierul sau înconjoară TOT (inclusiv `fetch`) cu `if (__DEV__)` |
| M2 | La eșecul `getDatabase()` se apelează totuși `setDbReady(true)` în `.finally()` → UI-ul se deschide fără DB, orice operație ulterioară crapă neașteptat | `app/_layout.tsx:459-472` | Ecran de eroare dedicat „Baza de date nu a putut fi inițializată" cu retry, fără a marca DB ca ready |
| M3 | Fluxul de livrare face 3 apeluri API directe; cădere de rețea între `confirm-delivery` și `complete` lasă cursa blocată în `delivered` | `src/components/features/delivery/EnhancedDeliveryFlow.tsx:103-113` | Vezi **FM-1**; salvează local pasul curent + `postTolerant` și pentru `complete` |
| M4 | `depart` / `arrive` / `set-destination` sunt apeluri API directe, fără fallback offline | `app/driver-ops/departure-flow.tsx:48`, `arrival-flow.tsx:45`, `app/trip/[tripId].tsx:84` | Vezi **FM-1** — enqueue în `sync_queue` |
| M5 | Background location tracking absent complet pe iOS — geofence-urile nu funcționează pe iPhone | `src/lib/location.ts:261-262` | Implementează `UIBackgroundModes: location` sau documentează Android-only |
| M6 | `getCurrentPositionAsync({ timeInterval })` — `timeInterval` NU e timeout; funcția poate bloca indefinit pe telefoane cu GPS lent | `src/hooks/useCurrentLoaderParcel.ts:78` | `Promise.race` cu un `setTimeout` real de reject |
| M7 | Idempotency key generat cu `Math.random()`; crash între `createOutboxEntry()` și `enqueue()` → la repornire alt UUID → posibilă dublă procesare pe server | `src/sync/outbox.ts:32` | Derivă cheia din UUID-ul entității (`fuel_logs_${id}`); `outbox.ts` pare nefolosit — elimină-l sau primește cheia ca parametru |
| M8 | Stringuri în engleză pe ecrane cheie, într-o aplicație altfel în română | `SignatureCapture.tsx:33,36` (`Clear`/`Confirm`), `WeightInput.tsx:17,23`, `TripProgress.tsx:17-25`, `OfflineBanner.tsx:20` | Tradu în română (P3/P4/P5/P10 din analiza UI/UX) |
| M9 | `EnhancedDeliveryFlow` / `departure-flow` trimit semnături base64 (50-200 KB) direct în body-ul JSON — poate depăși limite nginx/proxy | `EnhancedDeliveryFlow.tsx:113`, `departure-flow.tsx:48` | Upload binar dedicat (ca la bonuri), trimite URL-ul |

### 🟡 Severitate medie

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| M10 | Retry fără backoff — intrările `failed` se reîncearcă în bloc la fiecare 60s/foreground → spam de erori, consum baterie | `src/db/sync-queue-repo.ts:103-113` | Adaugă `next_retry_at` cu backoff exponențial (`retry_count² · 30s`); filtrează în `dequeue()` |
| M11 | Conflict resolution mereu „server wins", silențios — modificări locale pierdute fără avertizare | `src/sync/conflict.ts:21-38` | Vezi **FM-3** |
| M12 | Coada de sync poate crește nelimitat — nicio curățare a intrărilor `failed` vechi | `src/db/sync-queue-repo.ts` | `DELETE FROM sync_queue WHERE status='failed' AND retry_count>10 AND updated_at < now-7d` |
| M13 | `listAll()` fără limită — la luni de utilizare, mii de rânduri în memorie | `trips-repo.ts:75`, `fuel-logs-repo.ts:129`, `bale-loads-repo.ts:133` | Adaugă `limit/offset` sau filtru temporal implicit (ultimele 30 zile) |
| M14 | `clearLocalData()` la logout nu șterge fișierele locale (loguri NDJSON, rapoarte GPS pending, poze bon, machineId) — artefacte rămân pentru următorul utilizator | `src/lib/storage.ts:63-75` | `FileSystem.deleteAsync` pe directoarele de loguri/locație |
| M15 | `auth-store` nu persistă — la repornire, `role`/`userId` sunt `null` până la re-fetch; offline + restart = blocaj până la timeout 20s | `src/stores/auth-store.ts` | `persist` Zustand cu `expo-secure-store` pentru `userId`/`role` |
| M16 | Geofence notifications fără debounce — GPS oscilant la graniță → 2-3 alerte duplicate pentru același câmp | `src/hooks/useGeofenceNotifications.ts:57-109` | `Map<assignmentId, timestamp>`, ignoră duplicatele <60s |
| M17 | Notification ID generat cu `Date.now()+Math.random()` când serverul nu trimite `data.id` — push livrat de două ori → două notificări | `src/lib/notification-handler.ts:74` | Serverul trebuie să trimită mereu `data.id` stabil |
| M18 | `Accuracy.High` la 15s în background — consum baterie excesiv pentru utilaje lente | `src/lib/location.ts:283` | Vezi **FM-15** — adaptiv `Balanced`/`distanceInterval:50` |
| M19 | OCR fără feedback de calitate — text gol → `{}` fără mesaj | `src/lib/ocr/use-ocr-scan.ts` | Flag `ocrFailed` + mesaj „Introdu manual" |
| M20 | `uploadPendingReceipts()` citește 100 intrări `pending` și modifică payload-ul fără a le marca `in_flight` → race cu `push()` în același ciclu | `src/sync/SyncManager.ts:374-442` | Mutex `syncInProgress` sau marcaj `in_flight` la început |
| M21 | Push trimite tot batch-ul într-o cerere; fără garanție de ordonare pe dependințe (ex. `bale_load` înainte de `trip`-ul local) | `src/sync/push.ts:116-127` | Batch-uri separate per entitate cu ordine garantată, sau ordonare server-side |
| M22 | Logger face read-modify-write pe disc la fiecare flush (2s) — la log de 1 MB înseamnă 1 MB citit+scris la 2s, jank pe Android | `src/lib/logger.ts:49-54` | Scriere în mod `append` sau buffer de memorie mai agresiv |
| M23 | Culori hardcodate în loc de tokens `@strawboss/ui-tokens` (`STATUS_COLORS`, redefiniri `const PRIMARY = '#0A5C36'`) | `(driver)/index.tsx:25-51`, `CmrConfirmation.tsx:4-8`, `DeterioratedBalesInput.tsx:5-6`, `TripLoadedOverlay.tsx:132-218`, `GeofenceOverlay.tsx:66,101` | Extrage `STATUS_COLORS/LABELS` într-un `src/constants/tripStatus.ts` care consumă tokens |
| M24 | Contrast insuficient — `colors.tertiary` (`#8D6E63`) pe fundal `#F3DED8` ≈ 2.8:1 (sub WCAG AA) | `(driver)/index.tsx:342`, `(loader)/index.tsx:525,577`, `TaskList.tsx:192` ș.a. | Token nou `textSecondary` mai închis; vezi și **FM-8** |
| M25 | Canvas de semnătură fix 200px — pe ecrane mici cu tastatura deschisă, semnăturile CMR pot fi inutilizabile | `src/components/shared/SignatureCapture.tsx:59` | Înălțime procentuală (`SCREEN_HEIGHT*0.25`, min 180 / max 280) |
| M26 | `GeofenceOverlay` — `ActivityIndicator` cu `absoluteFill` se centrează pe tot modalul, nu pe buton; titlul devine `''` | `src/components/shared/GeofenceOverlay.tsx:156-161` | Folosește `<BigButton loading={saving} title="Confirmă" />` (suportă deja `loading`) |
| M27 | `fontScale()` limitează scalarea fontului la 120% — utilizatorii cu „Large Text" primesc font mai mic decât au setat | `src/utils/responsive.ts:12-13` | Respectă `PixelRatio.getFontScale()` nerestricționat sau `allowFontScaling` |
| M28 | Numpad fără `accessibilityRole`/`accessibilityLabel` (inconsistent cu `ProductionNumpad` care le are) | `src/components/ui/NumericPad.tsx:51-69` | Adaugă rol „button" + label per tastă |
| M29 | Schimbarea de parcelă (loader) cu >2 terenuri confirmă automat `otherTasks[0]` — operatorul nu poate alege vizual | `app/(loader)/index.tsx:183-195` | `FlatList` cu buton per teren când `length > 1` |
| M30 | `FuelEntryFlow` — titlul pasului apare duplicat (în header fix „Combustibil" + în corp) | `src/components/features/fuel/FuelEntryFlow.tsx` + `app/(driver)/fuel.tsx` | Elimină `Text styles.title` din pași sau mută titlul dinamic în header |

### 🟢 Severitate mică

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| M31 | Typo „Se înarcă harta…" (lipsă `c`) | `src/components/map/GeofenceEditorView.tsx:63` | „Se încarcă harta…" |
| M32 | `purgeCompleted()` apelat de două ori per ciclu de sync | `src/sync/SyncManager.ts:61,134` | Elimină dublarea |
| M33 | `useNetworkStatus` inițializat cu `true` → fals „online" la boot, posibil sync prematur | `src/hooks/useNetworkStatus.ts:10` | Inițializare `null`, tratată în `useSync` |
| M34 | `border-radius` inconsistent (12/16/20/24) între carduri/inputuri | mai multe fișiere | Adaugă `radii` în `ui-tokens` și folosește-l uniform |
| M35 | `delivery-flow` „Cursa nu a fost găsită" — ecran fără buton de navigare, posibil blocaj pe Android back | `app/driver-ops/delivery-flow.tsx:48-57` | Adaugă `BigButton` „Înapoi la curse" → `router.replace('/(driver)')` |
| M36 | Ecranul de succes la încărcare se închide după 1.5s — prea scurt, fără animație | `app/loader-ops/load-bales.tsx:228` | Crește la 2.5s + animație scale-in |
| M37 | Banner de instrucțiuni hartă geofence la `fontSize: 12` — ilizibil în soare | `app/(geofence-maker)/map.tsx:267,370` | `fontSize:14`, `fontWeight:'600'`, padding mai mare |
| M38 | FAB-urile rămân active în timpul salvării geofence-ului — dublu „Câmp nou" posibil | `app/(geofence-maker)/map.tsx:52` | `disabled={isSaving}` + spinner |
| M39 | `useLocationTracking` polează starea GPS la 5s prin bridge nativ (12 apeluri/min) | `src/hooks/useLocationTracking.ts:36` | Interval 30s sau EventEmitter din `location.ts` |
| M40 | `useMyTasks` aduce tot planul zilnic și filtrează client-side pe `assignedUserId` | `src/hooks/useMyTasks.ts:68-93` | Endpoint server-side `/my-tasks/:date` |
| M41 | `GeofenceEditorView` — la eroare WebView doar dispare loading-ul, fără mesaj/retry | `src/components/map/GeofenceEditorView.tsx:59` | Stare de eroare separată + buton refresh |
| M42 | Tranziții bruște între pașii fluxurilor multi-pas | `FuelEntryFlow`, `ConsumableFlow`, `EnhancedDeliveryFlow` | Animație slide (vezi **FM-10**) |
| M43 | `MAX_PENDING_REPORTS = 400` — rapoartele GPS peste limită se pierd, fără feedback | `src/lib/location.ts:67` | Avertizează utilizatorul când coada de locație e plină |

---

# Partea III — Web Admin: propuneri de feature noi

### FW-1 · Panou de alerte live în TopBar

**Problema.** Butonul de notificări din `TopBar` există dar e **inert** — nu face nimic.

**Soluția.** Conectează-l la `useAlerts(apiClient, { acknowledged: 'false' })`: badge cu
numărul de alerte nerecunoscute + dropdown cu ultimele 5 alerte critice, fiecare cu link
direct la `/${slug}/alerts`. Invalidarea realtime pentru `alerts` există deja.

**Efort:** S-M · **Impact:** 🟡 Medie.

---

### FW-2 · Pagină de detaliu mașină cu timeline de activitate

**Problema.** Click pe o mașină din `machines/page.tsx` nu duce nicăieri. Nu există o
vedere agregată per mașină, deși toate datele există.

**Soluția.** Rută `/${slug}/machines/[machineId]`: status curent, ultima poziție GPS pe
o mini-hartă Leaflet, grafic de activitate pe 7 zile (ore de funcționare din operații),
consum combustibil, log de alerte, curse recente în care a participat.

**Efort:** M-L · **Impact:** 🟡 Medie-Mare.

---

### FW-3 · Export PDF raport zilnic operațional

**Problema.** Există export CSV (`csv.ts`) dar nu un raport prezentabil pentru management.

**Soluția.** Buton pe pagina Reports/Operations care generează un PDF cu KPI-urile zilei,
lista curselor finalizate, evenimentele de alertă și snapshot-uri ale graficelor recharts.

**Efort:** M · **Impact:** 🟡 Medie.

---

### FW-4 · KPI cu comparație față de perioada anterioară

**Problema.** KPI-urile din dashboard și reports nu au referință de trend.

**Soluția.** Afișează variația față de perioada anterioară —
`„Baloți azi: 245 ▲ +12% față de ieri"`. `useDashboardTrending` returnează deja date
istorice care pot alimenta calculul.

**Efort:** S-M · **Impact:** 🟡 Medie.

---

### FW-5 · Hartă live cu poziții de mașini în timp real

**Problema.** `RealtimeProvider` nu subscrie la `machine_locations` — pozițiile pe hartă
se stagnează până la re-navigare (vezi W6).

**Soluția.** Subscrie tabela și afișează mașinile colorate pe tip (loader/truck/baler),
cu ultimul timestamp GPS și statusul cursei. Aceasta deblochează o hartă cu adevărat
„live".

**Efort:** M · **Impact:** 🟡 Medie-Mare.

---

### FW-6 · Vedere „Command Center" pentru dispecerat

**Problema.** Dispecerul navighează între pagina Map și Operations ca să aibă imaginea
completă.

**Soluția.** O vedere full-screen split: stânga = harta live (LeafletMap minimal),
dreapta = feed de curse active cu actualizări realtime. O singură pagină de comandă
operațională.

**Efort:** L · **Impact:** 🟡 Medie.

---

# Partea IV — Web Admin: bug-uri și îmbunătățiri prioritizate

### 🔴 Severitate mare

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| W1 | Link de alertă către cursă fără prefixul `/${slug}/` → **404** | `src/components/features/alerts/AlertList.tsx:107` | `useOrgSlug()` + `/${slug}/trips/${alert.tripId}` |
| W2 | `RealtimeProvider` nu subscrie `machines` și `machine_locations` — flota și harta nu se actualizează live | `src/lib/realtime.tsx` | Adaugă subscriere `postgres_changes` pe ambele tabele |
| W3 | `TripList` — anteturile de coloane hardcodate în engleză, fără i18n | `src/components/features/trips/TripList.tsx:61-121` | `buildColumns(t)` în loc de `baseColumns` constant |
| W4 | `AlertList` — `categoryLabels`, `severityLabels`, `Acknowledge…`, `No alerts to show` hardcodate în engleză | `AlertList.tsx:22-43,138-151` | Chei `alerts.*` în ambele cataloage + `useI18n()` |
| W5 | `AccountsPage` — zeci de stringuri (`ROLE_LABELS`, titluri carduri, modal „Cont nou") fără `t()` | `accounts/page.tsx` | Internaționalizare completă |
| W6 | `TripDetail` — etichete de secțiuni hardcodate, amestec română/engleză | `TripDetail.tsx:69,83,106,134,153,189,212` | Chei i18n pentru toate secțiunile |

### 🟡 Severitate medie

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| W7 | `StatusBadge` — cele 10 stări hardcodate în engleză | `src/components/shared/StatusBadge.tsx:17-28` | Chei `trips.status.*` |
| W8 | `DataTable` — empty state „No data available" hardcodat | `src/components/shared/DataTable.tsx:104` | Cheie i18n, prop opțional |
| W9 | `MachinesPage` — anteturi tabel și stat cards fără i18n | `machines/page.tsx:638-670` | Internaționalizare |
| W10 | `RecentTrips` — „Curse recente" / „Nu sunt curse recente" fără `t()` | `RecentTrips.tsx:17,27` | Internaționalizare |
| W11 | `useDeleteMachine` local folosește queryKey ad-hoc `['machines']` în loc de `queryKeys.machines.all` | `machines/page.tsx:558-562` | Folosește factory-ul de query keys |
| W12 | Câmpul de search din Trips fără debounce — apel API la fiecare tastă | `trips/page.tsx:26-36` | Debounce sau refolosește `SearchInput` |
| W13 | `KmlImportModal` — buclă `for + await new Promise` peste `mutate()`; dacă `mutate` aruncă sincron, Promise-ul nu se rezolvă | `map/page.tsx:203-218` | `mutateAsync()` cu `try/catch` |
| W14 | Dashboard — `tripsQuery.data` castat forțat la `PaginatedResponse`; dacă backend-ul întoarce array, `trips` devine `[]` | `page.tsx:35-36` | Folosește `normalizeList` ca în `trips/page.tsx` |
| W15 | Realtime — după `MAX_RETRIES` conexiunea e abandonată tăcut, fără indicator/reconectare manuală | `realtime.tsx:65-70` | Indicator vizual + buton „Reconectează" |
| W16 | Settings — `notificationPrefs` nu există în `UpdateProfilePayload`; toggle-urile sunt probabil decor (backend-ul ignoră câmpul) | `settings/page.tsx:277-280` | Adaugă câmpul în tip + backend, sau elimină UI-ul |
| W17 | Reports — toate cele 5 query-uri rulează la mount indiferent de tabul activ | `reports/page.tsx:95-102` | `enabled: tab === '…'` per query |
| W18 | Layout — starea de loading (auth check) e un `<div>` alb gol | `layout.tsx:116` | Spinner / skeleton de layout |
| W19 | Sidebar — fără comportament mobile (drawer/overlay) | `layout.tsx:120-121`, `Sidebar.tsx` | Drawer pentru `<640px` |
| W20 | Dashboard — `KpiCard` primește emoji unicode hardcodat ca icon | `page.tsx:55-71` | Iconuri Lucide (ca la `OperationsPage`) |
| W21 | Dashboard — un singur spinner pentru 4 query-uri; o pagină goală până se încarcă tot | `page.tsx:38-49` | Loading per secțiune + skeleton cards |

### 🟢 Severitate mică

| # | Problemă | Fișier:linie | Recomandare |
|---|----------|--------------|-------------|
| W22 | `DataTable` — sortarea (`[...data].sort()`) nu e memoizată | `DataTable.tsx:44-54` | `useMemo([data, sortKey, sortDir])` |
| W23 | `ro.json` — diacritice lipsă în `tasks.*` (`Asigneaza`, `Asociaza`, `Marcheaza`) | `messages/ro.json:435-460` | Corectează: `Asociază`, `Marchează` etc. |
| W24 | `MapPage` — `hiddenFarmIds`/`hiddenParcelIds` ca `Set` nou la fiecare toggle → re-render costisitor al hărții Leaflet | `map/page.tsx:464-577` | `Record<string, boolean>` sau toggle pe id |
| W25 | `TripDetail` — `useDocuments()` rulează pentru orice cursă, deși CMR-ul e relevant doar la `delivered`/`completed` | `TripDetail.tsx:59-62` | `enabled` condiționat de status |
| W26 | `Trips` — `statusOptions` transformă `TripStatus` în label prin `replace` fără i18n | `trips/page.tsx:19-24` | `t('trips.status.*')` |

---

# Partea V — Foaie de parcurs sugerată

Ordinea ține cont de risc și de raportul valoare/efort.

### Sprint 1 — Igienă și siguranță (rapid, risc mic)
- **M1** — elimină `debug-ingest.ts` din producție *(risc real în producție)*
- **M2** — ecran de eroare la eșec DB la boot
- **M8** / **W3-W6** — traduceri lipsă (mobile + web)
- **W1** — repară linkul de alertă rupt (404)
- **M26**, **M31**, **M35** — fix-uri UI rapide
- **FM-9** — feedback haptic

### Sprint 2 — Offline-first complet (cel mai mare câștig de fiabilitate)
- **FM-1** — tranziții de cursă offline *(piesa centrală)*
- **FM-2** — indicator de coadă sync + ecran „Date în așteptare"
- **M9** — upload binar pentru semnături
- **M10**, **M12** — backoff la retry + curățare coadă

### Sprint 3 — Prevenirea erorilor + ergonomie
- **FM-4** — undo de 5s
- **FM-5** — detecție duplicate
- **FM-6** — confirmare cu countdown
- **FM-10** — indicator de pași
- **FM-8** — mod contrast ridicat
- **M23**, **M24** — tokens de culoare/contrast

### Sprint 4 — GPS, vizibilitate, valoare
- **FM-15** — tracking GPS adaptiv + background iOS
- **M6**, **M16**, **M18** — fix-uri GPS
- **FM-11** — ecran „Activitatea mea azi"
- **FM-12** — widget cursă activă
- **FW-1**, **FW-5** — panou alerte + hartă live web

### Backlog (valoare mare, efort mare — de planificat separat)
- **FM-13** — planificator offline cu hartă parcele
- **FM-14** / **FW-3** — rapoarte PDF
- **FM-16** — alarme inactivitate mașină
- **FM-17** — onboarding per rol
- **FM-18** — flux OCR îmbunătățit
- **FW-2** — pagină detaliu mașină
- **FW-6** — Command Center

---

*Document generat din analiza codului la 2026-05-19. Recomandat de actualizat după
fiecare sprint pentru a reflecta ce s-a livrat.*
