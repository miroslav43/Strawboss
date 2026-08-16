# Adăugarea limbii maghiare (`hu`) — plan de implementare

> **Pentru agenți:** SUB-SKILL OBLIGATORIU: folosește `superpowers:subagent-driven-development` (recomandat) sau `superpowers:executing-plans` ca să implementezi acest plan task cu task. Pașii folosesc sintaxă de checkbox (`- [ ]`) pentru urmărire.

**Obiectiv:** Un utilizator StrawBoss cu `users.locale = 'hu'` vede aplicația — web și telefon — integral în maghiară, inclusiv notificările push, emailurile, SMS-urile și PDF-urile generate de server.

**Arhitectură:** Un singur SSOT pentru mulțimea de limbi în `packages/types/src/locale.ts` (idiomul deja folosit de `presence.ts`), care înlocuiește 17 uniuni `'en' | 'ro'` duplicate. Cataloagele client se bifurcă din `en` (paritate perfectă verificată) și sunt păzite de un linter rescris care descoperă limbile din director, nu din literale. Backend-ul, care azi n-are absolut nicio infrastructură i18n, primește locale-ul prin auth guard și un singur punct de randare per canal de ieșire (push / email+SMS / PDF).

**Tech stack:** TypeScript, Zod, NestJS 11 + Fastify, Next.js 15 App Router, Expo SDK 54, Handlebars (PDF), PostgreSQL.

---

## Constrângeri globale

Fiecare task moștenește implicit secțiunea asta.

1. **Se lucrează direct pe `main`.** Fără branch-uri de feature. Commit + push pe main. O rutină auto-commit-uie arborele de lucru, deci nu lăsa fișiere pe jumătate scrise între taskuri.
2. **Doar `typecheck`, niciodată `build` de UI.** Rulează `./strawboss.sh typecheck <target>`. Numele țintelor sunt numele de pachet fără prefix: `types`, `validation`, `api`, `backend`, `admin-web` (**nu** `admin`), `mobile`. O țintă greșită afișează fals „All typechecks passed".
3. **Ordinea de build a pachetelor e obligatorie:** `types → validation → ui-tokens → domain → api`. Niciun consumator nu face alias `@strawboss/*` către sursă — totul se rezolvă prin `dist/`. Modificarea sursei fără `./strawboss.sh build packages` lasă enum-ul vechi compilat în viață.
4. **Commit înainte de deploy.** Imaginile Swarm sunt etichetate cu short-SHA-ul git; modificările necommit-uite produc aceeași etichetă, iar `strawboss.sh prod` face silențios no-op.
5. **Limba țintă: maghiară standard (Ungaria).** Nu maghiară ardelenească, nu împrumuturi din română.
6. **Glosarul de mai jos e obligatoriu.** Un termen = o traducere, în tot catalogul, web și mobil.
7. **Nu redenumi niciodată valori de enum stocate în baza de date.** `crop_type` (`grau`, `orz`, `rapita`, `plante_nutret`, `altele`), `farm_entity_type`, `depot_type`, `user_role` (`transportator`) sunt cuvinte românești păstrate **ca date**. Se traduc doar etichetele de afișare.
8. **Zero migrații de bază de date în acest plan.** `users.locale` e `TEXT DEFAULT 'en'` fără CHECK — verificat pe producție: zero constrângeri, 38 rânduri `ro`, 6 `en`, 0 NULL. Postgres acceptă `'hu'` de azi. *Decizie explicită: nu adăugăm CHECK*, pentru că ar introduce o suprafață de respingere inexistentă acum (ar eșua cu 23514 → 500 în loc de 400 curat) și ar transforma orice limbă viitoare în migrație.

### Ieșit din scop — decizii conștiente, nu scăpări

| Ce | De ce |
|---|---|
| Retraducerea textului deja **salvat** (alerte, outbox, note de audit) | E proză înghețată la scriere, în 6 locuri de INSERT. Retroactivul cere coloane `(message_key, params jsonb)` randate la citire + migrație + backfill + schimbări de randare în ambele apps. Doar alertele **noi** sunt în maghiară. |
| Fusul orar `Europe/Bucharest` (`backend/service/src/common/date.ts:11`, `seasons.service.ts:194`) | Maghiara e limba interfeței pentru oameni dintr-o firmă din România. Dacă vreodată apare o organizație care *operează* în Ungaria, asta devine bug de corectitudine (Budapesta e UTC+1/+2 — ziua operațională s-ar grupa cu o oră diferență), nu de formatare. Documentat, neatins. |
| String-urile native Android (`withDeviceOwner.js:620/1072/1074/1094`, `withAlwaysOnTracking.js:152/153/164/165`, canalele din `notifications.ts:56/61/67/82`) | Sunt literale Kotlin emise la prebuild, fără context JS — `tStatic` nu ajunge la ele. În plus, un canal Android **nu se redenumește** după ce a fost creat, deci traducerea n-ar avea efect pe niciun telefon existent din flotă. |
| Clauzele de drept românesc din PDF-ul de comandă (`comanda.hbs:67-68` — cursul BNR, asigurarea CMR) | Conținut juridic, nu traducere. Rămân în română; se traduc doar etichetele din jur. De escaladat către un jurist dacă apare vreodată o comandă maghiară reală. |
| Selector de limbă în aplicația mobilă | Nu există azi și nu există nici detecție de limbă a dispozitivului (`expo-localization` nu e instalat). Flota e Device-Owner; adminul setează limba din web. |

---

## Glosar obligatoriu

Traducătorul (agentul care umple cataloagele) trebuie să respecte tabelul ăsta literal. Termenii marcați ⚠️ sunt cei unde **catalogul actual se contrazice pe sine** — maghiara alege o singură variantă și nu moștenește ruptura.

| Concept | EN | RO | **HU (obligatoriu)** |
|---|---|---|---|
| balot | Bale | Balot / Baloți | **bála** |
| presă de balotat ⚠️ | Baler | Balotieră *și* Operator presă | **bálázó** |
| încărcător (utilaj) | Loader | Încărcător | **rakodógép** |
| camion | Truck | Camion | **kamion** |
| utilaj ⚠️ | Machine | Utilaj *și* Mașină | **gép** (niciodată `autó`) |
| cursă | Trip | Cursă | **fuvar** |
| parcelă ⚠️ | Parcel / Field | Câmp / Parcelă / Teren | **tábla** (agronomic; **nu** `parcella`, **nu** `föld`) |
| fermă | Farm | Fermă | **gazdaság** |
| depozit ⚠️ | Depot / Deposit | Depozit | **raktár** |
| destinație de livrare | Delivery destination | Destinație | **átadási hely** |
| șofer | Driver | Șofer | **sofőr** |
| dispecer | Dispatcher | Dispecer | **diszpécser** |
| operator depozit ⚠️ | Depot Manager / Depot operator | Operator depozit | **raktáros** |
| creator geofence ⚠️ | Geofence Maker / Field planner | Creator geofence | **geokerítés-szerkesztő** |
| transportator | Transporter | Transportator | **fuvarozó** |
| beneficiar | Beneficiary | Beneficiar | **megrendelő** (**nu** `kedvezményezett` — cognatul literal e greșit într-un context de comandă comercială) |
| motorină | Diesel | Motorină | **gázolaj** |
| consumabil | Consumable | Consumabil | **fogyóeszköz** |
| kilometraj | Odometer | Kilometraj | **kilométeróra-állás** |
| greutate brută / netă | Gross / Net weight | Greutate brută / netă | **bruttó / nettó tömeg** |
| tară | Tare | Tară | **önsúly** |
| suprafață / hectar | Area / Hectare | Suprafață / hectar | **terület / hektár** (unitatea `ha` rămâne `ha`) |
| geofence | Geofence | Geofence | **geokerítés** |
| alertă | Alert | Alertă | **riasztás** |
| sarcină | Task | Sarcină | **feladat** |
| sezon | Season | Sezon | **szezon** |
| sincronizare | Sync | Sincronizare | **szinkronizálás** |

### Nu se traduc

`CMR` (cod internațional de document — cel mult `CMR fuvarlevél`), `CUI`, `APIA`, `ha`, `kg`, `km`, `PIN`, `GPS`, `CSV`, `PDF`, numerele de înmatriculare.

**`Aviz`** — rămâne `Aviz`. Denumește un document românesc fizic (aviz de însoțire a mărfii) pe care operatorul îl ține efectiv în mână; e lăsat netradus până și în catalogul englez.

### Statusuri de cursă (10 valori, formă participială consecventă)

`planned` → **tervezett** · `loading` → **rakodás alatt** · `loaded` → **felrakodva** · `in_transit` → **úton** · `arrived` → **megérkezett** · `delivering` → **kirakodás alatt** · `delivered` → **leszállítva** · `completed` → **lezárva** · `cancelled` → **törölve** · `disputed` → **vitatott**

### Statusuri de recoltă — capcană de coliziune

Enum-ul de recoltă are și el `loading` / `loaded`, dar înseamnă **altceva** decât la cursă (câmp care se eliberează vs. camion care se umple). În maghiară trebuie dezambiguizate, altfel cele două chip-uri de status se citesc identic: recolta folosește **`betakarítás alatt`** / **`betakarítva`**, cursa folosește formele de mai sus.

### Plural — capcană gramaticală

Pluralele sunt chei-gemene alese printr-un ternar la locul apelului (7 perechi, 14 frunze: `map.importKmlTitle`/`…Plural`, `map.importN`/`…Plural`, `farms.unassignedSummary`, `farms.selectedCount`, `parcels.count`, `machines.filter.countSingular`, `accounts.filter.countSingular`). Nu există ICU MessageFormat.

**În maghiară substantivul rămâne la SINGULAR după un numeral** — „2 tábla", niciodată „2 táblák". Deci **ambii membri ai fiecărei perechi primesc exact același string maghiar.** Nu „corecta" schema în 3 forme.

---

## Structura de fișiere

**Fișiere noi**

| Fișier | Responsabilitate |
|---|---|
| `packages/types/src/locale.ts` | SSOT: `SUPPORTED_LOCALES`, `Locale`, `DEFAULT_LOCALE`, `isLocale()` |
| `apps/admin-web/messages/hu.json` | Catalogul web, 2183 frunze |
| `apps/admin-web/messages/.identical-ok.json` | Lista de chei cărora li se permite să fie identice cu engleza |
| `apps/admin-web/src/lib/use-locale-format.ts` | Un singur hook de formatare dată/număr conștient de limbă |
| `apps/admin-web/src/components/shared/LangToggle.tsx` | Componenta unică de comutare a limbii (înlocuiește 3 copii identice) |
| `apps/mobile/src/i18n/hu.ts` | Catalogul mobil, 1123 frunze |
| `backend/service/src/common/i18n/index.ts` | Runtime-ul i18n al backend-ului: `tServer(locale, key, params)` |
| `backend/service/src/common/i18n/catalogs/{en,ro,hu}.ts` | Cataloagele de server (push, email/SMS, etichete PDF) |

**Fișiere rescrise**

| Fișier | De ce |
|---|---|
| `apps/admin-web/scripts/check-i18n-parity.mjs` | Azi hardcodează `'en.json'` și `'ro.json'` ca literale și verifică doar mulțimea de chei — un `hu.json` clonat din engleză trece curat. Devine: descoperă limbile din director, verifică și valorile. |
| `backend/service/src/messaging/message-templates.ts` | 389 linii, 8 tipuri de mesaj, 100% românește, semnătură fără parametru de limbă. Devine `messageTemplates[kind][locale](ctx)`. |

---

## Faza 0 — Igienizare

**De ce prima:** fiecare bug de mai jos e în ambele cataloage existente. Dacă bifurcăm `hu` înainte, îl copiem a treia oară.

---

### Task 0.1: Repară interpolarea cu acoladă simplă în admin-web

Cheia `tripRequests.unplanConfirm` folosește `{label}` / `{who}`, dar `interpolate` din admin-web prinde doar `{{...}}`. Dialogul `window.confirm()` arată azi literal textul „Ștergi cursa {label} pentru {who}?". Bug live, în ambele limbi.

Mobile-ul a rezolvat deja asta corect (`apps/mobile/src/lib/i18n.tsx:25-38`): două treceri, `{{x}}` prima, apoi `{x}` — iar `{x}` fără parametru corespunzător e **lăsat neatins**, ceea ce protejează `settings.organization.accessCodeHint`, unde `{slug}` e text literal, nu placeholder.

**Fișiere:**
- Modifică: `apps/admin-web/src/lib/i18n.tsx:43-48`
- Verifică: `apps/admin-web/src/components/features/trips/AuxTripSection.tsx:133`

- [ ] **Pas 1: Scrie testul care pică**

Creează `apps/admin-web/scripts/check-i18n-interpolation.mjs`:

```js
#!/usr/bin/env node
/**
 * Fiecare placeholder dintr-un catalog trebuie să fie de o formă pe care
 * `interpolate()` din src/lib/i18n.tsx chiar o înlocuiește.
 *
 * Excepții: chei unde `{...}` e text literal, nu placeholder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');

/** Chei unde acoladele sunt text literal afișat utilizatorului. */
const LITERAL_BRACES = new Set(['settings.organization.accessCodeHint']);

/** Chei interpolate manual la locul apelului, nu prin t(). */
const MANUAL_INTERPOLATION = new Set([
  'beneficiaries.deleteConfirm',
  'beneficiaryPortal.pinStep1Title',
]);

function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p));
    else out.push([p, String(v)]);
  }
  return out;
}

let failures = 0;
for (const file of readdirSync(messagesDir).filter((f) => f.endsWith('.json'))) {
  const cat = JSON.parse(readFileSync(join(messagesDir, file), 'utf8'));
  for (const [key, value] of flatten(cat)) {
    if (LITERAL_BRACES.has(key) || MANUAL_INTERPOLATION.has(key)) continue;
    // Scoate întâi {{x}}, apoi vezi dacă a mai rămas vreun {x}.
    const leftover = value.replace(/\{\{(\w+)\}\}/g, '').match(/\{(\w+)\}/g);
    if (leftover) {
      console.error(`${file} :: ${key} — placeholder cu acoladă simplă: ${leftover.join(', ')}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\ni18n: ${failures} placeholder(e) pe care interpolate() nu le înlocuiește.`);
  process.exit(1);
}
console.log('i18n: toate placeholder-ele sunt de o formă interpolabilă.');
```

- [ ] **Pas 2: Rulează-l ca să confirmi că pică**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-interpolation.mjs
```

Așteptat: FAIL, exact două linii — `en.json :: tripRequests.unplanConfirm` și `ro.json :: tripRequests.unplanConfirm`, ambele raportând `{label}, {who}`.

- [ ] **Pas 3: Portează interpolarea cu două treceri din mobil**

În `apps/admin-web/src/lib/i18n.tsx`, înlocuiește funcția `interpolate` (liniile 43-48):

```tsx
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  // Cataloagele folosesc două convenții de placeholder. Le susținem pe ambele,
  // identic cu apps/mobile/src/lib/i18n.tsx:
  //  1. {{param}} — înlocuit cu valoarea, sau '' când lipsește (comportament vechi).
  //  2. {param}   — înlocuit cu valoarea; LĂSAT NEATINS când nu există parametru
  //     corespunzător, ca acoladele literale (settings.organization.accessCodeHint
  //     conține un '{slug}' care e text, nu placeholder) să nu fie distruse.
  // Trecerea dublă rulează prima, ca {{param}} să fie complet consumat.
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
    .replace(/\{(\w+)\}/g, (match, k) => (params[k] != null ? String(params[k]) : match));
}
```

- [ ] **Pas 4: Rulează din nou testul și typecheck-ul**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-interpolation.mjs
cd /srv/apps/Strawboss && ./strawboss.sh typecheck admin-web
```

Așteptat: `i18n: toate placeholder-ele sunt de o formă interpolabilă.` și typecheck curat.

- [ ] **Pas 5: Înregistrează scriptul în package.json**

În `apps/admin-web/package.json`, lângă `"i18n:parity"`:

```json
"i18n:interp": "node scripts/check-i18n-interpolation.mjs",
```

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src/lib/i18n.tsx apps/admin-web/scripts/check-i18n-interpolation.mjs apps/admin-web/package.json
git commit -m "fix(i18n): admin-web nu înlocuia placeholder-ele cu acoladă simplă

tripRequests.unplanConfirm folosește {label}/{who}, dar interpolate() prindea
doar {{...}} — dialogul de confirmare afișa literal '{label}'. Portez trecerea
dublă din mobil, care lasă intacte acoladele literale ({slug} din accessCodeHint).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 0.2: Închide cele ~83 de frunze englezești scăpate în `ro.json`

Traducătorul maghiar lucrează firesc din coloana română (limba operațională vie). Dacă 83 de chei sunt de fapt engleză netradusă, traducerea maghiară moștenește tăcut engleza.

**Fișiere:**
- Modifică: `apps/admin-web/messages/ro.json`
- Creează: `apps/admin-web/messages/.identical-ok.json`

- [ ] **Pas 1: Listează scăpările**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node -e "
const en=require('./messages/en.json'), ro=require('./messages/ro.json');
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>{
  const q=p?p+'.'+k:k;
  return (v&&typeof v==='object'&&!Array.isArray(v))?flat(v,q):[[q,String(v)]];
});
const E=new Map(flat(en)), R=new Map(flat(ro));
const same=[...E].filter(([k,v])=>R.get(k)===v);
console.log('identice cu engleza:', same.length);
same.forEach(([k,v])=>console.log(k+'  ==  '+JSON.stringify(v)));
"
```

- [ ] **Pas 2: Împarte lista în două**

Parcurge rezultatul manual și clasifică fiecare intrare:

- **Legitim identice** — unități și coduri care nu se traduc în nicio limbă: `ha`, `kg`, `km`, `CMR`, `CUI`, `APIA`, `PIN`, `GPS`, `CSV`, `PDF`, `—`, string-uri care sunt doar placeholder. Astea intră în allowlist.
- **Scăpări reale** — de tradus în română: perechile `Online`/`Offline` (×22, în 6 namespace-uri independente), `Active`/`Inactive`, `Username`, `PIN` ca etichetă de câmp, `Email`, `Reset` (×14), `Export CSV` / `Export PDF` (×5), `Diesel`, `Electric`, `Basic`, `Pro`, `Enterprise`.

Scrie allowlist-ul în `apps/admin-web/messages/.identical-ok.json`:

```json
{
  "_comment": "Chei cărora li se permite să fie identice cu en.json în orice limbă — unități, coduri de document, nume de instituții. check-i18n-parity.mjs eșuează pentru orice ALTĂ frunză identică cu engleza, ca un catalog clonat și netradus să nu treacă.",
  "allow": [
    "common.unitHa",
    "beneficiaries.form.cui"
  ]
}
```

> Înlocuiește exemplele cu lista reală obținută la Pasul 2. Nu ghici căile de chei — copiază-le din rezultatul comenzii.

- [ ] **Pas 3: Tradu scăpările reale în `ro.json`**

Traduceri obligatorii pentru cele recurente:

| EN | RO |
|---|---|
| Online | Online |
| Offline | Deconectat |
| Active | Activ |
| Inactive | Inactiv |
| Username | Utilizator |
| Email | Email |
| Reset | Resetează |
| Export CSV | Exportă CSV |
| Export PDF | Exportă PDF |
| Diesel | Motorină |
| Electric | Electric |

> `Online`, `Email`, `Electric`, `Basic`, `Pro`, `Enterprise` rămân identice și în română — pune-le în allowlist, nu le forța.

- [ ] **Pas 4: Verifică paritatea de chei nealterată**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs
```

Așteptat: `i18n: en.json and ro.json keys match (2183 keys).` — numărul **trebuie** să rămână 2183. Dacă s-a schimbat, ai adăugat sau șters o cheie din greșeală.

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/messages/ro.json apps/admin-web/messages/.identical-ok.json
git commit -m "fix(i18n): traduc frunzele englezești rămase în ro.json

~83 de chei erau engleză netradusă în catalogul român (Online/Offline, Active/
Inactive, Username/Reset, Export CSV/PDF). Le închid ÎNAINTE de a bifurca o a
treia limbă, ca traducerea maghiară să nu moștenească engleza prin coloana RO.
Cele legitim identice (unități, coduri) trec într-un allowlist explicit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 0.3: Reconciliază etichetele duplicate și contradictorii

~120-150 din cele 2183 de frunze sunt concepte duplicate, iar duplicatele **se contrazic deja între ele**. Bifurcarea acum coace contradicțiile într-o a treia limbă și triplează costul reconcilierii de mai târziu.

**Fișiere:**
- Modifică: `apps/admin-web/messages/en.json`, `apps/admin-web/messages/ro.json`

- [ ] **Pas 1: Confirmă contradicțiile**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node -e "
const en=require('./messages/en.json'), ro=require('./messages/ro.json');
for (const p of ['accounts.role','features.item.roles']) {
  const get=(o)=>p.split('.').reduce((a,k)=>a?.[k], o);
  console.log('--- '+p);
  const e=get(en)||{}, r=get(ro)||{};
  Object.keys(e).forEach(k=>console.log('  '+k.padEnd(20), JSON.stringify(e[k]).padEnd(22), JSON.stringify(r[k])));
}
"
```

Așteptat — perechile divergente: `depot_manager` „Depot Manager" vs „Depot operator"; `geofence_maker` „Geofence Maker" vs „Field planner"; iar în română `baler_operator` „Operator balotieră" vs „Operator presă".

- [ ] **Pas 2: Alege o formulare per rol și aplic-o în ambele namespace-uri**

`features.item.roles.*` se aliniază la `accounts.role.*` (acela e cel văzut de admin în ecranul de conturi, deci e formularea canonică):

| Rol | EN canonic | RO canonic |
|---|---|---|
| `depot_manager` | Depot Manager | Operator depozit |
| `geofence_maker` | Geofence Maker | Creator geofence |
| `baler_operator` | Baler Operator | Operator balotieră |
| `loader_operator` | Loader Operator | Operator încărcător |

- [ ] **Pas 3: Verifică paritatea și numărul de chei**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs && node scripts/check-i18n-interpolation.mjs
```

Așteptat: tot 2183 de chei (reconciliem *valori*, nu ștergem chei) și interpolare curată.

- [ ] **Pas 4: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/messages/en.json apps/admin-web/messages/ro.json
git commit -m "fix(i18n): unific etichetele de rol contradictorii dintre accounts.role și features.item.roles

Același rol apărea cu două formulări diferite ('Depot Manager' vs 'Depot
operator', 'Operator balotieră' vs 'Operator presă'). Aliniez la accounts.role.*,
care e formularea văzută de admin. Fac asta înainte de bifurcarea maghiarei ca
să nu coc contradicția într-o a treia limbă.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 0.4: Trece prin `t()` componentele hardcodate din dashboard

`TrendingChart` și `TopOperators` sunt pe **dashboard-ul principal** și n-au niciun import de i18n — un utilizator englez vede deja românește acolo. Va fi raportat ca regresie a lansării maghiare, deși e preexistent.

**Fișiere:**
- Modifică: `apps/admin-web/src/components/features/dashboard/TrendingChart.tsx:30,40`
- Modifică: `apps/admin-web/src/components/features/dashboard/TopOperators.tsx:21,35`
- Modifică: `apps/admin-web/src/components/shared/DocumentViewer.tsx:134,142,155`
- Modifică: `apps/admin-web/messages/en.json`, `apps/admin-web/messages/ro.json`

- [ ] **Pas 1: Găsește textul exact**

```bash
cd /srv/apps/Strawboss/apps/admin-web
sed -n '25,45p' src/components/features/dashboard/TrendingChart.tsx
sed -n '18,40p' src/components/features/dashboard/TopOperators.tsx
sed -n '130,158p' src/components/shared/DocumentViewer.tsx
```

- [ ] **Pas 2: Adaugă cheile în ambele cataloage**

În `en.json` și `ro.json`, sub namespace-ul `dashboard` (creează-l dacă nu există; păstrează ordinea alfabetică a namespace-urilor din fișier):

```json
"dashboard": {
  "noData": "No data available",
  "productionLast7Days": "Production — last 7 days",
  "topOperators": "Top operators"
},
"documentViewer": {
  "open": "Open",
  "download": "Download",
  "noFile": "No file available"
}
```

Echivalentele române: `"Nu sunt date disponibile"`, `"Producție — ultimele 7 zile"`, `"Top operatori"`, `"Deschide"`, `"Descarcă"`, `"Niciun fișier disponibil"`.

- [ ] **Pas 3: Cablează componentele**

În fiecare din cele trei fișiere adaugă importul și hook-ul, apoi înlocuiește literalele:

```tsx
import { useI18n } from '@/lib/i18n';
// ...în corpul componentei:
const { t } = useI18n();
```

`TrendingChart.tsx` — `'Nu sunt date disponibile'` → `{t('dashboard.noData')}`, `'Productie ultimele 7 zile'` → `{t('dashboard.productionLast7Days')}`.
`DocumentViewer.tsx` — `'Deschide'` → `{t('documentViewer.open')}`, `'Descarcă'` → `{t('documentViewer.download')}`, `'No file available'` → `{t('documentViewer.noFile')}`.

- [ ] **Pas 4: Verifică**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs
cd /srv/apps/Strawboss && ./strawboss.sh typecheck admin-web
```

Așteptat: numărul de chei crește de la 2183 la **2189** (6 chei noi), paritate OK, typecheck curat.

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src/components apps/admin-web/messages
git commit -m "fix(i18n): dashboard-ul principal era românește hardcodat pentru orice limbă

TrendingChart și TopOperators n-aveau niciun import de i18n — un utilizator
englez vedea deja românește pe pagina principală. Idem DocumentViewer, care
amesteca română și engleză în același component.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faza 1 — SSOT + instalația

---

### Task 1.1: Creează sursa unică de adevăr pentru limbi

**Fișiere:**
- Creează: `packages/types/src/locale.ts`
- Modifică: `packages/types/src/index.ts:1-5`

**Interfețe:**
- Produce: `SUPPORTED_LOCALES: readonly ['en','ro','hu']`, `type Locale = 'en'|'ro'|'hu'`, `DEFAULT_LOCALE: Locale`, `isLocale(v: unknown): v is Locale`. Toate taskurile următoare consumă de aici.

- [ ] **Pas 1: Scrie fișierul SSOT**

```ts
/**
 * Limbile de interfață — SURSA UNICĂ DE ADEVĂR.
 *
 * Mulțimea asta era duplicată în 17 locuri (uniuni TS, enum-uri zod, DTO-uri de
 * backend, array-uri de picker), ceea ce însemna că adăugarea unei limbi cerea
 * 17 editări coordonate și că oricare uitată eșua TĂCUT: enum-ul zod respinge
 * cu 400, uniunea TS respinge la compilare, dar un array de picker uitat pur și
 * simplu nu afișează limba și nimic nu se plânge.
 *
 * Modelat după presence.ts / features.ts — aceeași convenție de SSOT.
 *
 * NOTĂ: coloana `users.locale` e TEXT fără CHECK. Gardul de runtime e enum-ul
 * zod construit din `SUPPORTED_LOCALES`, nu baza de date. Asta e deliberat —
 * un CHECK ar eșua cu 23514 → 500 în loc de 400 curat și ar transforma orice
 * limbă viitoare în migrație.
 */

/** Fiecare limbă în care aplicația poate fi afișată. Ordinea e cea din pickere. */
export const SUPPORTED_LOCALES = ['ro', 'en', 'hu'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Limba dată unui cont când nimeni n-a ales alta.
 *
 * `ro`, nu `en`: e limba operațională vie (38 din 44 de conturi de producție)
 * și e deja ce presupune aplicația mobilă. DEFAULT-ul coloanei din baza de date
 * spune 'en', dar niciun cont nu-l atinge vreodată — admin-users.service.ts
 * scria hardcodat 'ro' peste el.
 */
export const DEFAULT_LOCALE: Locale = 'ro';

/** Numele fiecărei limbi ÎN LIMBA EI (endonim) — pentru pickere. */
export const LOCALE_ENDONYMS: Record<Locale, string> = {
  ro: 'Română',
  en: 'English',
  hu: 'Magyar',
};

/**
 * Eticheta BCP-47 folosită pentru formatarea datelor și numerelor.
 * Separată de `Locale` fiindcă Intl vrea o etichetă completă, nu un cod de doi.
 */
export const LOCALE_BCP47: Record<Locale, string> = {
  ro: 'ro-RO',
  en: 'en-GB',
  hu: 'hu-HU',
};

/** Gardă de tip pentru orice string venit din DB, localStorage sau rețea. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalizează orice string de limbă la una suportată.
 *
 * Acceptă etichete complete ('hu-HU', 'ro-RO') și e insensibilă la majuscule.
 * Orice necunoscut cade pe DEFAULT_LOCALE.
 *
 * ATENȚIE: extinderea `SUPPORTED_LOCALES` face funcția asta corectă automat.
 * Orice normalizator scris de mână care testează prefixe una câte una NU se
 * actualizează singur — exact așa a fost pierdută maghiara pe telefoane.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.toLowerCase();
  return SUPPORTED_LOCALES.find((l) => lower.startsWith(l)) ?? DEFAULT_LOCALE;
}
```

- [ ] **Pas 2: Exportă din index**

În `packages/types/src/index.ts`, după linia 5 (`export * from './season.js';`):

```ts
export * from './locale.js';
```

- [ ] **Pas 3: Construiește pachetele și verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh build packages && ./strawboss.sh typecheck types
```

Așteptat: build curat, typecheck curat.

- [ ] **Pas 4: Confirmă că `dist/` chiar conține `hu`**

```bash
cd /srv/apps/Strawboss && grep -rn "SUPPORTED_LOCALES" packages/types/dist/locale.js
```

Așteptat: o linie care conține `['ro', 'en', 'hu']`. **Dacă nu apare, restul planului va eșua tăcut** — niciun consumator nu face alias către sursă, totul se rezolvă prin `dist/`.

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add packages/types/src/locale.ts packages/types/src/index.ts packages/types/dist
git commit -m "feat(types): SSOT pentru limbile de interfață, cu hu inclus

Mulțimea de limbi era duplicată în 17 locuri. O centralizez după modelul
presence.ts, cu endonime, etichete BCP-47 și un normalizeLocale care se extinde
singur când adaugi o limbă — spre deosebire de normalizatoarele scrise de mână
care testează prefixe unul câte unul.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1.2: Lărgește gardul de runtime (Zod) și clienții tipizați

Ăsta e gardul **dur**: `PATCH /api/v1/profile {locale:'hu'}` dă 400 aici, înainte de orice SQL.

**Fișiere:**
- Modifică: `packages/validation/src/schemas/profile.schema.ts:6,12`
- Modifică: `packages/validation/src/schemas/user.schema.ts:74`
- Modifică: `packages/api/src/hooks/use-profile.ts:38,50`
- Modifică: `packages/api/src/hooks/use-admin-users.ts:28`

**Interfețe:**
- Consumă: `SUPPORTED_LOCALES`, `Locale` din `@strawboss/types` (Task 1.1).

- [ ] **Pas 1: Lărgește schemele Zod**

În `packages/validation/src/schemas/profile.schema.ts`, adaugă importul sus și înlocuiește ambele enum-uri:

```ts
import { SUPPORTED_LOCALES } from '@strawboss/types';

/** Limba interfeței — stocată pe users.locale, controlează i18n în admin-web și pe telefon. */
export const updateProfileLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  notificationPrefs: z.record(z.boolean()).optional(),
  signatureSpecimenUrl: signatureUrlSchema.nullable().optional(),
});
```

În `packages/validation/src/schemas/user.schema.ts:74`, aceeași înlocuire pentru `updateUserSchema`. **Nu atinge linia 42** (`locale: z.string()` în schema de citire) — e deliberat permisivă.

- [ ] **Pas 2: Adaugă `locale` la crearea de cont**

Tot în `user.schema.ts`, în `createUserSchema` (care azi n-are deloc cheia `locale`):

```ts
  locale: z.enum(SUPPORTED_LOCALES).optional(),
```

Fără asta, chiar cu totul lărgit, **un admin nu poate crea un utilizator maghiar** — trebuie să-l creeze român și apoi să-și amintească să-l modifice.

- [ ] **Pas 3: Lărgește hook-urile tipizate**

`packages/api/src/hooks/use-profile.ts` — importă `Locale` din `@strawboss/types`, apoi liniile 38 și 50:

```ts
mutationFn: (locale: Locale) => client.patch<User>('/api/v1/profile', { locale }),
```
```ts
locale?: Locale;
```

`packages/api/src/hooks/use-admin-users.ts:28` — `locale?: Locale;` în `UpdateUserPayload`.

- [ ] **Pas 4: Reconstruiește și verifică ambele straturi**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh build packages && ./strawboss.sh typecheck validation && ./strawboss.sh typecheck api
```

- [ ] **Pas 5: Dovedește că enum-ul COMPILAT s-a schimbat**

```bash
cd /srv/apps/Strawboss && grep -rn "ro\|en\|hu" packages/validation/dist/schemas/profile.schema.js | head -5
```

Așteptat: enum-ul compilat conține `hu`. Asta e capcana numărul unu din tot planul — typecheck-ul trece local pe `.d.ts` vechi, faci deploy, iar backend-ul validează în continuare la runtime pe `.js`-ul vechi. UI-ul arată că limba se salvează; serverul refuză tăcut.

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add packages/validation packages/api
git commit -m "feat(validation,api): acceptă hu; createUserSchema primește locale

Enum-urile zod erau gardul dur care dădea 400 pe locale:'hu'. Le leg de
SUPPORTED_LOCALES. Adaug și locale la createUserSchema — fără el un admin nu
poate CREA un cont maghiar, doar unul român pe care să-l modifice apoi.
Includ dist/ în commit: imaginile Swarm sunt etichetate cu SHA-ul git, iar un
dist necommit-uit înseamnă deploy silențios no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1.3: Backend — lărgește DTO-urile și repară INSERT-ul care naște toți userii români

**Fișiere:**
- Modifică: `backend/service/src/profile/profile.controller.ts:49`
- Modifică: `backend/service/src/profile/profile.service.ts:177`
- Modifică: `backend/service/src/admin-users/admin-users.service.ts:42,169`

- [ ] **Pas 1: Lărgește cele trei DTO-uri**

În fiecare din cele trei fișiere, importă `Locale` din `@strawboss/types` și înlocuiește `locale?: 'en' | 'ro';` cu `locale?: Locale;`.

`profile.controller.ts` și `profile.service.ts` duplică DTO-ul de mână — **ambele trebuie schimbate**, altfel typecheck-ul backend-ului pică.

- [ ] **Pas 2: Adaugă `locale` la `CreateUserDto`**

În `admin-users.service.ts`, în interfața `CreateUserDto`:

```ts
  /** Limba de interfață pentru contul nou. Implicit DEFAULT_LOCALE. */
  locale?: Locale;
```

- [ ] **Pas 3: Repară INSERT-ul hardcodat**

`admin-users.service.ts:169` conține literalul SQL `'ro'` ca a noua valoare. Înlocuiește-l:

```ts
        ${dto.locale ?? DEFAULT_LOCALE},
```

și importă `DEFAULT_LOCALE` din `@strawboss/types`.

- [ ] **Pas 4: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck backend
```

- [ ] **Pas 5: Confirmă că nu mai există literale de limbă în backend**

```bash
cd /srv/apps/Strawboss && grep -rn "'en' | 'ro'\|'ro' | 'en'" backend/service/src/ ; echo "(gol = curat)"
```

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add backend/service/src
git commit -m "fix(admin-users): INSERT-ul hardcoda locale='ro' pentru orice cont nou

Toți userii creați prin POST /api/v1/admin-users se năşteau români, peste
DEFAULT-ul coloanei. Chiar cu enum-urile lărgite, un admin n-ar fi putut crea
un cont maghiar. Parametrizez literalul și lărgesc cele trei DTO-uri (controller
și service duplică DTO-ul de profil de mână — ambele).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1.4: Admin-web — repară cele patru eșecuri tăcute din wiring

Astea sunt bug-urile care nu dau nicio eroare. Le grupez într-un task pentru că toate patru trebuie să fie adevărate simultan ca un utilizator să-și poată alege maghiara și s-o și **păstreze**.

**Fișiere:**
- Modifică: `apps/admin-web/src/lib/i18n.tsx:12-23,36-41,63`
- Modifică: `apps/admin-web/src/app/[slug]/(dashboard)/settings/page.tsx:342,510-511`
- Modifică: `apps/admin-web/src/app/[slug]/(dashboard)/accounts/page.tsx:516,535,678,689`
- Modifică: `apps/admin-web/messages/{en,ro}.json` (`settings.lang.hu`)

- [ ] **Pas 1: Bifurcă `hu.json` din engleză**

```bash
cd /srv/apps/Strawboss/apps/admin-web && cp messages/en.json messages/hu.json
```

Din engleză, nu din română: ambele au aceleași 2189 de căi în aceeași ordine (verificat), dar engleza e sursa de traducere. Fișierul e deocamdată englezesc ca text — se traduce în Faza 3.

> Se face **înaintea** cablării, deliberat, ca build-ul să nu treacă niciodată printr-o stare roșie. `Record<Locale, …>` de la Pasul 3 refuză să compileze fără fișierul ăsta.

- [ ] **Pas 2: Adaugă `settings.lang.hu` în ambele cataloage existente**

`settings.lang` (linia 208 în ambele fișiere) e **singurul loc din interiorul cataloagelor unde e enumerată mulțimea de limbi**. Convenția e endonimul în paranteză.

`en.json`:
```json
    "lang": {
      "en": "English",
      "ro": "Romanian (Română)",
      "hu": "Hungarian (Magyar)"
    },
```

`ro.json`:
```json
    "lang": {
      "en": "Engleză (English)",
      "ro": "Română",
      "hu": "Maghiară (Magyar)"
    },
```

- [ ] **Pas 3: Cablează catalogul `hu` în provider — inclusiv cele două validatoare tăcute**

În `apps/admin-web/src/lib/i18n.tsx`:

```tsx
import enMessages from '../../messages/en.json';
import roMessages from '../../messages/ro.json';
import huMessages from '../../messages/hu.json';
import { isLocale, type Locale } from '@strawboss/types';

export type { Locale };

const STORAGE_KEY = 'strawboss-locale';

// Record<Locale, …> e deliberat: adăugarea unei limbi în SSOT rupe BUILD-UL aici
// până când catalogul ei chiar există. E singurul eșec zgomotos din lanț.
const catalogs: Record<Locale, Record<string, unknown>> = {
  en: enMessages as Record<string, unknown>,
  ro: roMessages as Record<string, unknown>,
  hu: huMessages as Record<string, unknown>,
};
```

Înlocuiește `normalizeUiLocale` (liniile 36-41):

```tsx
/** Mapează limba din DB/utilizator la o limbă de interfață suportată. */
export function normalizeUiLocale(raw: string | null | undefined): Locale {
  // Delegă către SSOT. Varianta veche testa prefixele una câte una
  // (`if (lower.startsWith('ro')) return 'ro'; return 'en';`), ceea ce înseamnă
  // că orice limbă adăugată era tăcut colapsată la engleză.
  return normalizeLocale(raw);
}
```

…importând `normalizeLocale` din `@strawboss/types`.

Înlocuiește validatorul din `readStoredLocale` (linia 63):

```tsx
  return isLocale(s) ? s : null;
```

> Fără pasul ăsta, `setLocale` scrie `'hu'` în localStorage, iar cititorul îl respinge la următoarea încărcare — alegerea utilizatorului se „uită" la fiecare reload, și pentru că `hydrateFromProfile` iese devreme când există *orice* valoare în localStorage, nici profilul nu-l salvează.

- [ ] **Pas 4: Repară linia care ȘTERGE limba utilizatorului**

`settings/page.tsx:342` e cea mai distructivă linie din tot planul:

```tsx
      setSelectedLocale((profile.locale as Locale) === 'ro' ? 'ro' : 'en');
```

Colapsează orice valoare care nu e `ro` la `en`. Un utilizator cu `hu` în baza de date deschide Setări, vede engleza preselectată, salvează orice alt câmp — iar `handleSaveProfile` face PATCH cu `locale: selectedLocale`, suprascriindu-i maghiara cu engleză. Înlocuiește:

```tsx
      setSelectedLocale(normalizeUiLocale(profile.locale));
```

Și înlocuiește cele două `<option>` hardcodate (liniile 510-511) cu o listă generată:

```tsx
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`settings.lang.${l}`)}
                  </option>
                ))}
```

- [ ] **Pas 5: Repară formularul de conturi — inclusiv ternarul care ar eticheta maghiara „English"**

`accounts/page.tsx`. Linia 516 redeclară uniunea inline, deci lărgirea tipului partajat **nu ajunge aici**:

```tsx
  locale: Locale;
```

Linia 535:
```tsx
    locale: normalizeUiLocale(user.locale),
```

Linia 678 — array-ul de picker:
```tsx
              {SUPPORTED_LOCALES.map((l) => (
```

Linia 689 — ternarul binar. Lăsat așa, butonul maghiar ar scrie literal „English" și ar exista **două butoane cu „English"**:
```tsx
                  {LOCALE_ENDONYMS[l]}
```

> Ăsta e pickerul prin care adminul setează limba aplicației **mobile** pe contul altcuiva — singura cale prin care un șofer maghiar poate fi vreodată configurat.

- [ ] **Pas 6: Verifică — trebuie să treacă**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck admin-web
```

Așteptat: **PASS**. Catalogul maghiar există structural (englezesc ca text), deci `Record<Locale, …>` e satisfăcut. Linterul de cataloage din `typecheck` va raporta însă `✗ hu.json — ~2130 netraduse`, ceea ce e corect și așteptat până la sfârșitul Fazei 3.

> Dacă `typecheck` iese cu 0 dar linterul zice că hu e netradus, totul e în regulă. Dacă `tsc` însuși pică, ai uitat Pasul 1.

- [ ] **Pas 7: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src apps/admin-web/messages
git commit -m "feat(admin-web): cablează hu și repar cele 4 eșecuri tăcute de wiring

- settings/page.tsx:342 colapsa orice limbă ≠ro la 'en' și PATCH-ul următor
  suprascria preferința utilizatorului — pierdere activă de date, nu doar afișare
- i18n.tsx:63 respingea 'hu' la citirea din localStorage, deși setLocale îl
  scria: alegerea se uita la fiecare reload
- accounts/page.tsx:689 era un ternar binar care ar fi etichetat butonul maghiar
  'English'
- normalizeUiLocale testa prefixele unul câte unul; acum delegă către SSOT

Bifurc messages/hu.json (englezesc ca text) în același commit: Record<Locale,…>
e proiectat să rupă build-ul fără el, și e singurul eșec ZGOMOTOS din tot lanțul
— restul modurilor de eșec ale acestui feature sunt tăcute.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1.5: Extrage `LangToggle` în loc să adaugi maghiara în trei copii

Trei componente identice byte-cu-byte (`login/page.tsx:59`, `request/page.tsx:203`, `request/[beneficiarySlug]/page.tsx:189`) plus cheia `'strawboss-locale'` hardcodată ca string brut în alte trei locuri. Patru locuri de reparat, trei în care maghiara poate fi uitată independent.

**Fișiere:**
- Creează: `apps/admin-web/src/components/shared/LangToggle.tsx`
- Modifică: `apps/admin-web/src/lib/i18n.tsx` (exportă `STORAGE_KEY`)
- Modifică: `apps/admin-web/src/app/(auth)/login/page.tsx:56-75,89`
- Modifică: `apps/admin-web/src/app/[slug]/request/page.tsx:203,243`
- Modifică: `apps/admin-web/src/app/[slug]/request/[beneficiarySlug]/page.tsx:189,314`

- [ ] **Pas 1: Exportă cheia de stocare**

În `apps/admin-web/src/lib/i18n.tsx`, linia 18: `export const STORAGE_KEY = 'strawboss-locale';`

- [ ] **Pas 2: Scrie componenta unică**

```tsx
'use client';

import { SUPPORTED_LOCALES, type Locale } from '@strawboss/types';

/**
 * Comutatorul de limbă din antetele publice (login, portalul de solicitări).
 *
 * Exista în trei copii identice, fiecare cu propriul array `['ro','en']` — trei
 * locuri independente în care o limbă nouă putea fi uitată, și un recenzent care
 * repara unul singur credea că a terminat.
 */
export function LangToggle({
  locale,
  onPick,
}: {
  locale: Locale;
  onPick: (l: Locale) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-stone-200 bg-white/80 p-0.5 text-xs font-semibold shadow-sm backdrop-blur">
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onPick(l)}
          aria-pressed={locale === l}
          className={`rounded-full px-3 py-1 uppercase tracking-wide transition-colors ${
            locale === l ? 'bg-green-700 text-white' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
```

> Verifică clasele Tailwind exacte din `login/page.tsx:65-72` și copiază-le, ca aspectul să nu se schimbe.

- [ ] **Pas 3: Înlocuiește cele trei copii**

În fiecare din cele trei pagini: șterge definiția locală `function LangToggle(...)`, importă `{ LangToggle } from '@/components/shared/LangToggle'`, și înlocuiește `localStorage.setItem('strawboss-locale', …)` cu `STORAGE_KEY` importat.

- [ ] **Pas 4: Confirmă că nu mai există copii**

```bash
cd /srv/apps/Strawboss
grep -rn "\['ro', *'en'\]\|\['ro','en'\]" apps/admin-web/src/ ; echo "(gol = curat)"
grep -rn "'strawboss-locale'" apps/admin-web/src/
```

Așteptat: primul gol; al doilea, o singură apariție — declarația din `i18n.tsx`.

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src
git commit -m "refactor(admin-web): un singur LangToggle în loc de trei copii identice

Trei array-uri ['ro','en'] independente plus cheia de localStorage hardcodată în
patru locuri. O limbă nouă putea fi uitată în oricare, tăcut.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faza 2 — Plasa de siguranță (înainte de traducere)

**De ce înainte:** gardul de paritate existent nu păzește nimic. Vrem un test care **pică**, apoi îl facem verde traducând.

---

### Task 2.1: Rescrie linterul de cataloage să descopere limbile și să verifice valorile

Scriptul actual hardcodează `'en.json'` și `'ro.json'` ca literale (liniile 27-28) și compară **doar mulțimea de chei**. Un `hu.json` clonat din engleză, cu toate cele 2189 de valori netraduse, trece curat. Și oricum nu-l rulează nimeni — verificat: absent din `strawboss.sh`, din toate cele patru `.github/workflows/*.yml` și din `.claude/settings.json`; nu există director `.husky`.

**Fișiere:**
- Rescrie: `apps/admin-web/scripts/check-i18n-parity.mjs`
- Modifică: `strawboss.sh` (funcția `typecheck`)

- [ ] **Pas 1: Scrie noul linter**

```js
#!/usr/bin/env node
/**
 * Gard de paritate și calitate pentru cataloagele admin-web.
 *
 * `en.json` e referința. Fiecare alt `<locale>.json` din messages/ trebuie să
 * definească exact aceleași frunze — nici mai multe, nici mai puține — și să nu
 * lase nicio frunză netradusă.
 *
 * Limbile se DESCOPERĂ din director. Adăugarea uneia = pui un fișier acolo;
 * aici nu e nimic de editat. Varianta veche hardcoda 'en.json' și 'ro.json',
 * deci un al treilea catalog era invizibil pentru gard.
 *
 * Verificarea valorilor există fiindcă paritatea de chei singură e o iluzie de
 * siguranță: un catalog clonat din engleză și netradus are paritate perfectă.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');
const REFERENCE = 'en';

const allowFile = join(messagesDir, '.identical-ok.json');
/** Frunze cărora li se permite să fie identice cu engleza: unități, coduri, nume de instituții. */
const allowIdentical = new Set(
  existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).allow : [],
);

/** @param {Record<string, unknown>} obj @returns {Map<string,string>} */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else out.set(p, String(v));
  }
  return out;
}

const locales = readdirSync(messagesDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  .map((f) => basename(f, '.json'));

if (!locales.includes(REFERENCE)) {
  console.error(`i18n: lipsește catalogul de referință ${REFERENCE}.json`);
  process.exit(1);
}

const ref = flatten(JSON.parse(readFileSync(join(messagesDir, `${REFERENCE}.json`), 'utf8')));
let failed = false;

for (const locale of locales.filter((l) => l !== REFERENCE)) {
  const cat = flatten(JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8')));

  const missing = [...ref.keys()].filter((k) => !cat.has(k));
  const extra = [...cat.keys()].filter((k) => !ref.has(k));
  const empty = [...cat].filter(([, v]) => v.trim() === '').map(([k]) => k);
  const untranslated = [...cat]
    .filter(([k, v]) => ref.get(k) === v && !allowIdentical.has(k))
    .map(([k]) => k);

  const problems = [
    ['lipsesc din', missing],
    ['în plus în', extra],
    ['goale în', empty],
    ['identice cu engleza (netraduse) în', untranslated],
  ].filter(([, list]) => list.length);

  if (problems.length) {
    failed = true;
    console.error(`\n✗ ${locale}.json`);
    for (const [label, list] of problems) {
      console.error(`  ${list.length} ${label} ${locale}.json:`);
      console.error(list.slice(0, 40).map((k) => `    ${k}`).join('\n'));
      if (list.length > 40) console.error(`    … și încă ${list.length - 40}`);
    }
  } else {
    console.log(`✓ ${locale}.json — ${cat.size} chei, toate traduse`);
  }
}

if (failed) {
  console.error('\ni18n: verificarea cataloagelor a eșuat.');
  process.exit(1);
}
console.log(`\ni18n: ${locales.length} cataloage în paritate (${ref.size} chei fiecare).`);
```

- [ ] **Pas 2: Rulează-l pe starea actuală — trebuie să treacă**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs
```

Așteptat: `✓ ro.json — 2189 chei, toate traduse` și `i18n: 2 cataloage în paritate (2189 chei fiecare).`

> Dacă raportează chei „identice cu engleza", allowlist-ul din Task 0.2 e incomplet. Completează-l acum — asta e exact motivul pentru care Faza 0 vine prima.

- [ ] **Pas 3: Leagă-l de `typecheck` ca să-l ruleze cineva**

Implementarea **nu e în `strawboss.sh`** — e `cmd_typecheck()` în `scripts/04-build.sh:62`. Inserează blocul de mai jos imediat după `esac` (linia 94), înainte de verificarea finală de la linia 96. Rădăcina repo-ului e `$STRAWBOSS_ROOT`, exportată de `strawboss.sh:21`; formatarea imită `_run_check`, care e definită local la linia 68.

```bash
  if [ "$target" = "all" ] || [ "$target" = "admin-web" ]; then
    printf "  ${ARROW}  %-20s" "i18n catalogs"
    if (cd "$STRAWBOSS_ROOT/apps/admin-web" \
        && node scripts/check-i18n-parity.mjs >/dev/null \
        && node scripts/check-i18n-interpolation.mjs >/dev/null); then
      echo -e "${GREEN}pass${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      failed=1
    fi
  fi
```

- [ ] **Pas 4: Verifică integrarea**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck admin-web
```

Așteptat: în output apare o linie `i18n catalogs … pass`.

> ⚠️ **Capcană de verificare, confirmată live.** Ramura `*` din `cmd_typecheck` (linia 92) rulează `pnpm --filter "@strawboss/$target"`. Un nume de țintă greșit nu potrivește niciun proiect, pnpm iese cu 0, iar scriptul afișează vesel `✓ All typechecks passed.` — testat: `./strawboss.sh typecheck nonexistent-package` iese cu 0. Numele corecte sunt `types`, `validation`, `ui-tokens`, `domain`, `api`, `backend`, `admin-web`, `mobile`. **`admin` nu e o țintă validă** și îți va da un fals verde. (Eșecurile reale *sunt* raportate corect — `strawboss.sh` are `set -euo pipefail`, deci un `tsc` picat oprește scriptul.)

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/scripts/check-i18n-parity.mjs scripts/04-build.sh
git commit -m "feat(i18n): linterul de cataloage descoperă limbile și verifică valorile

Vechiul script hardcoda 'en.json'/'ro.json' și compara doar mulțimea de chei —
un hu.json clonat din engleză ar fi trecut curat, și oricum nu-l rula nimeni.
Acum enumeră directorul, semnalează frunzele goale și pe cele identice cu
engleza (cu allowlist explicit pentru unități și coduri), și rulează în typecheck.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2.2: Fă paritatea cataloagelor mobile o garanție de compilare

`apps/mobile/src/i18n/ro.ts:1733` exportă `export type TranslationKeys = typeof ro;` — dar **nimic din tot repo-ul nu-l importă**. Azi `en.ts` ar putea pierde 300 de chei și `tsc --noEmit` rămâne verde. Paritatea 1123/1123 e menținută manual.

**Fișiere:**
- Modifică: `apps/mobile/src/i18n/en.ts:1`

- [ ] **Pas 1: Anotează catalogul englez**

```ts
import type { TranslationKeys } from './ro';

export const en: TranslationKeys = {
  common: {
```

- [ ] **Pas 2: Verifică — trebuie să treacă acum**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck mobile
```

Așteptat: PASS. Cataloagele sunt în paritate azi, deci anotarea nu descoperă nimic — dar de acum înainte orice cheie lipsă e o eroare de compilare.

- [ ] **Pas 3: Dovedește că garda chiar mușcă**

Șterge temporar o cheie din `en.ts` (de exemplu `common.save`), rulează `./strawboss.sh typecheck mobile`, confirmă că pică cu `Property 'save' is missing`, apoi pune-o la loc și re-rulează ca să confirmi că trece.

> Nu sări pasul ăsta. Un gard netestat e exact ce era `check-i18n-parity.mjs`.

- [ ] **Pas 4: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/mobile/src/i18n/en.ts
git commit -m "feat(mobile): paritatea cataloagelor devine garanție de compilare

ro.ts exporta TranslationKeys, dar nimic nu-l importa — en.ts putea pierde 300
de chei și typecheck-ul rămânea verde. O anotare, și orice catalog incomplet
(inclusiv viitorul hu.ts) devine eroare de compilare.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faza 3 — Catalogul web (2189 chei)

**Regula de lucru pentru fiecare lot:** traduci un namespace complet, rulezi linterul, comiți. Linterul e verde doar când namespace-ul e integral tradus, deci nu poți „uita" jumătate.

**Regulile de traducere** (valabile pentru toate loturile, web și mobil):

1. **Glosarul e obligatoriu.** Un termen = o traducere.
2. **Păstrează placeholder-ele exact** — `{{name}}` rămâne `{{name}}`, `{label}` rămâne `{label}`. Nu traduce numele parametrului.
3. **Păstrează `\n`, markup-ul și ghilimelele tipografice** (`„"`, `'`) așa cum sunt în engleză.
4. **Perechile de plural primesc același string.** Maghiara ține substantivul la singular după numeral.
5. **Nu traduce** `CMR`, `CUI`, `APIA`, `Aviz`, `ha`, `kg`, `km`, `PIN`, `GPS`, `CSV`, `PDF`.
6. **Etichetele de enum stocat** (`crop_type` etc.) se traduc ca *afișare*: `grau`→`búza`, `orz`→`árpa`, `rapita`→`repce`, `plante_nutret`→`takarmánynövény`, `altele`→`egyéb`; `persoana_juridica`→`jogi személy`, `persoana_fizica`→`természetes személy`.
7. **Sursa e coloana ENGLEZĂ**, cu româna ca dezambiguizare când engleza e ambiguă. (Româna singură ar fi înșelătoare — de-asta a fost Task 0.2.)
8. **Ton:** instrucțiuni scurte, la persoana a II-a formală (`Ön`-neutru — evită atât `te`-familiar, cât și construcțiile birocratice greoaie).

---

### Task 3.1: Tradu primele patru namespace-uri

`apps/admin-web/messages/hu.json` există deja din Task 1.4 — bifurcat din engleză, netradus. Aici începe traducerea.

**Fișiere:**
- Modifică: `apps/admin-web/messages/hu.json`

- [ ] **Pas 1: Confirmă punctul de plecare**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs
```

Așteptat: FAIL — `✗ hu.json`, ~2130 chei „identice cu engleza (netraduse)", zero „lipsesc"/„în plus". **Ăsta e testul care pică.** Fiecare lot îl face mai mic; la finalul Fazei 3 trebuie să ajungă la zero.

- [ ] **Pas 2: Tradu namespace-urile `common`, `nav`, `login`, `settings`**

~130 de chei. Începi cu ele pentru că sunt vocabularul partajat pe care se sprijină restul catalogului — dacă alegi aici `tábla` pentru parcelă, tot restul urmează.

Traduceri obligatorii pentru elementele recurente de interfață:

| EN | HU |
|---|---|
| Save | Mentés |
| Cancel | Mégse |
| Delete | Törlés |
| Edit | Szerkesztés |
| Add | Hozzáadás |
| Search | Keresés |
| Loading… | Betöltés… |
| Back | Vissza |
| Confirm | Megerősítés |
| Close | Bezárás |
| Yes / No | Igen / Nem |
| Today | Ma |
| Online / Offline | Online / Offline |
| Active / Inactive | Aktív / Inaktív |
| Username | Felhasználónév |
| Password | Jelszó |
| Sign in | Bejelentkezés |
| Sign out | Kijelentkezés |
| Settings | Beállítások |
| Export CSV / PDF | CSV / PDF exportálás |

- [ ] **Pas 3: Verifică progresul lotului**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs 2>&1 | grep -c "^    " || true
```

Numărul de chei netraduse rămase trebuie să fi scăzut cu ~130. Confirmă și că nu apar chei `lipsesc` sau `în plus` — dacă apar, ai stricat structura JSON.

- [ ] **Pas 4: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/messages/hu.json
git commit -m "feat(i18n): catalog maghiar web — common, nav, login, settings

Primele ~130 de chei: vocabularul partajat pe care se sprijină restul
catalogului. Alegerile de aici (tábla, bála, fuvar) se propagă în tot restul.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3.2 – 3.7: Traduce restul catalogului web, namespace cu namespace

Fiecare task de mai jos urmează **exact aceiași cinci pași**: tradu namespace-urile listate în `apps/admin-web/messages/hu.json`, rulează `node scripts/check-i18n-parity.mjs`, confirmă că numărul de netraduse a scăzut cu volumul lotului și că nu au apărut chei lipsă/în plus, rulează `./strawboss.sh typecheck admin-web`, comite.

| Task | Namespace-uri | Chei | Note de traducere |
|---|---|---|---|
| **3.2** | `superAdmin` | 369 | Cel mai mare. Conține panoul de sănătate a dispozitivelor cu ~45 de string-uri englezești — traduce-le pe toate; e interfață pentru operatorul de flotă, nu jargon intern. |
| **3.3** | `tripRequests` (150), `trips` (29), `trip_detail` (46), `transporter` (59) | 284 | Aici trăiesc cele 10 statusuri de cursă. Folosește formele participiale din glosar, consecvent în toate cele patru namespace-uri. `beneficiary` → `megrendelő`. |
| **3.4** | `parcels` (120), `farms` (65), `map` (79), `mapList` (47), `leaflet` (40) | 351 | Zona cu cel mai mare risc terminologic: parcelă → **`tábla`** peste tot, fermă → **`gazdaság`**. Aici sunt și 5 din cele 7 perechi de plural — ambii membri primesc același string. Etichetele de `crop_type` se traduc ca afișare. |
| **3.5** | `tasks` (105), `machines` (65), `machineDetail` (100), `tracks` (31) | 301 | Utilaj → **`gép`**, niciodată `autó`. `machineDetail` conține producția de baloți — **`bála`** consecvent. |
| **3.6** | `reports` (113), `deposits` (57), `accounts` (103), `features` (58) | 331 | `features` sunt cele 114 chei generate de `featureLabelKey()` din `packages/types/src/features.ts:752` — sunt nume de funcționalități văzute de super-admin. Depozit → **`raktár`**. Etichetele de rol respectă reconcilierea din Task 0.3. |
| **3.7** | `beneficiaryPortal` (101), `portal` (52), `beneficiaries` (33), `season` (25) + tot ce a rămas | ~420 | Portalul public — ton mai formal, e văzut de clienți externi. Rulează linterul la final: trebuie să raporteze **`✓ hu.json — 2189 chei, toate traduse`**. |

- [ ] **Task 3.2** — `superAdmin`
- [ ] **Task 3.3** — cursele și transportatorii
- [ ] **Task 3.4** — hărți, parcele, ferme
- [ ] **Task 3.5** — sarcini și utilaje
- [ ] **Task 3.6** — rapoarte, depozite, conturi, funcționalități
- [ ] **Task 3.7** — portalul de beneficiari și restul

**Poarta de ieșire din Faza 3:**

```bash
cd /srv/apps/Strawboss/apps/admin-web && node scripts/check-i18n-parity.mjs
```

Trebuie să afișeze `i18n: 3 cataloage în paritate (2189 chei fiecare).` fără nicio linie `✗`.

---

## Faza 4 — Catalogul mobil (1123 chei)

**Diferența esențială față de web:** fallback-ul mobil pentru o cheie lipsă e **româna**, nu engleza (`i18n.tsx:61` și `:95`). Un `hu.ts` pe jumătate nu degradează elegant — produce salată maghiaro-română la mijlocul ecranului, **inclusiv în notificările push** emise din task-ul headless de sincronizare, prin `tStatic`.

**Și a doua diferență:** `expo-updates` nu e instalat (verificat: absent din `package.json`, zero apeluri `Updates.*`). **Nu există OTA doar-JS.** O greșeală de o literă în `hu.ts` costă un prebuild complet + `gradle assembleRelease` + bump de `versionCode` (acum 57) + rollout pe flotă. Termină catalogul înainte de primul build. (Dimensiunea nu e o problemă: ~100 KB de bytecode Hermes, ~3% din bundle-ul JS, ~0,07% din APK-ul de 144 MB.)

---

### Task 4.1: Repară normalizatorul de limbă și lanțul de fallback

**Ăsta e taskul care decide dacă feature-ul e vizibil pe telefoane.** Fără el poți pune `hu` în baza de date, în zod, în backend, în pickerul de admin, poți da drumul — și **fiecare telefon maghiar afișează 100% română**. Fără crash. Fără warning în `__DEV__` (avertismentul de la linia 64 se declanșează pe o *cheie* lipsă, niciodată pe o *limbă* lipsă). Fără typecheck picat, pentru că `auth-store` tipizează `locale` ca `string | null`.

**Fișiere:**
- Modifică: `apps/mobile/src/lib/i18n.tsx:1-13,40-44,59-61,93-95`

- [ ] **Pas 1: Bifurcă `hu.ts` din engleză**

```bash
cd /srv/apps/Strawboss/apps/mobile && sed 's/^export const en: TranslationKeys = {/export const hu: TranslationKeys = {/' src/i18n/en.ts > src/i18n/hu.ts
head -3 src/i18n/hu.ts
```

Așteptat: prima linie e importul `TranslationKeys`, a treia e `export const hu: TranslationKeys = {`. Corectează manual dacă `sed` n-a prins (depinde de anotarea adăugată în Task 2.2).

> Se face **înaintea** cablării, deliberat, ca `typecheck mobile` să nu treacă niciodată printr-o stare roșie. Fișierul e englezesc ca text — se traduce în Faza 4.

- [ ] **Pas 2: Importă catalogul și lărgește tipul**

```tsx
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { normalizeLocale as normalizeSupported, type Locale } from '@strawboss/types';
import { ro } from '@/i18n/ro';
import { en } from '@/i18n/en';
import { hu } from '@/i18n/hu';
import { useAuthStore } from '@/stores/auth-store';

export { ro, en, hu };
export type { Locale };

// Record<Locale, …>: adăugarea unei limbi în SSOT rupe compilarea aici până
// când catalogul ei chiar există.
const catalogs: Record<Locale, Record<string, unknown>> = {
  ro: ro as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
  hu: hu as unknown as Record<string, unknown>,
};
```

- [ ] **Pas 3: Înlocuiește normalizatorul allowlist-de-unul**

Vechiul (liniile 40-44) era `raw.toLowerCase().startsWith('en') ? 'en' : 'ro'` — o listă albă de exact o limbă, cu ramura implicită „română".

```tsx
/**
 * Mapează limba stocată pe cont la o limbă suportată.
 *
 * Delegă către SSOT-ul din @strawboss/types. Varianta veche testa un singur
 * prefix și trimitea tot restul pe română — orice limbă adăugată în DB era
 * colapsată tăcut, fără crash, fără warning, fără eroare de tip.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  return normalizeSupported(raw);
}
```

- [ ] **Pas 4: Repară lanțul de fallback în AMBELE locuri**

Atât `t` (liniile 59-61) cât și `tStatic` (93-95) cad azi pe `catalogs.ro`. Trebuie să cadă pe engleză, nu pe română — altfel o cheie maghiară lipsă apare în română, care nu e nici măcar o a doua limbă plauzibilă pentru un vorbitor de maghiară.

În `t`:
```tsx
      let raw = getByPath(catalogs[locale], key);
      // Fallback pe ENGLEZĂ, nu pe română: o cheie maghiară lipsă trebuie să
      // apară într-o limbă internațională, nu în cea locală. Contează și în
      // notificările push, care trec prin tStatic din task-ul headless.
      if (typeof raw !== 'string' && locale !== 'en') {
        raw = getByPath(catalogs.en, key);
      }
      if (typeof raw !== 'string') {
        raw = getByPath(catalogs.ro, key);
      }
```

Aplică exact aceeași cascadă în `tStatic`.

- [ ] **Pas 5: Verifică — trebuie să treacă**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck mobile
```

Așteptat: **PASS**. Catalogul maghiar există structural (englezesc ca text), iar anotarea `TranslationKeys` din Task 2.2 garantează că e complet.

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/mobile/src/lib/i18n.tsx
git commit -m "fix(mobile): normalizeLocale colapsa orice limbă ≠en la română

Era un allowlist de exact o limbă, cu ramura implicită 'ro'. Cu el în loc, un
telefon cu locale='hu' ar fi afișat 100% română — fără crash, fără warning în
__DEV__, fără typecheck picat (auth-store tipizează locale ca string). Delegă
acum către SSOT. Mut și fallback-ul de cheie lipsă de pe română pe engleză, în
t() ȘI în tStatic (acesta din urmă alimentează notificările push headless).

Bifurc src/i18n/hu.ts (englezesc ca text) în același commit, ca typecheck-ul să
nu treacă printr-o stare roșie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4.2: Tradu namespace-urile mobile mari

`apps/mobile/src/i18n/hu.ts` există deja din Task 4.1 — bifurcat din engleză, netradus.

**Fișiere:**
- Modifică: `apps/mobile/src/i18n/hu.ts`

- [ ] **Pas 1: Tradu `loader` (166), `shared` (97), `tabs` (66), `common` (18)**

347 de chei. `loader` e cel mai mare namespace mobil și e ecranul cel mai folosit din flotă. `shared` și `tabs` sunt navigația văzută de toate rolurile.

- [ ] **Pas 2: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck mobile
```

Anotarea `TranslationKeys` garantează că n-ai pierdut nicio cheie în timp ce traduceai.

- [ ] **Pas 3: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/mobile/src/i18n/hu.ts
git commit -m "feat(i18n): catalog maghiar mobil — loader, shared, tabs, common

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4.3 – 4.5: Restul catalogului mobil

Aceiași pași: tradu, `./strawboss.sh typecheck mobile`, commit.

| Task | Namespace-uri | Chei |
|---|---|---|
| **4.3** | `geofenceMaker` (77), `geofenceFarms` (37), `geofenceMap` (29), `map` (32), `parcel` (28) | 203 |
| **4.4** | `profile` (64), `driver` (54), `confirmDelivery` (44), `delivery` (39), `tripDetail` (38), `depositTrips` (27), `deposit` (12), `departureFlow` (7), `deliveryFlow` (3) | 288 |
| **4.5** | `production` (46), `onboarding` (39), `syncDetails` (35), `dailyReport` (30), `notifications` (24), `baler` (20), `trackingSetup` (18), `fuel` (18), `auth` (16), `activity` (10), `specimenCapture` (9), `consumables` (8), `stats` (6), `app` (4), `webOnly` (2) | 285 |

- [ ] **Task 4.3** — geofence și hărți
- [ ] **Task 4.4** — profil, șofer, livrare
- [ ] **Task 4.5** — producție, onboarding, sincronizare, restul

**Poarta de ieșire din Faza 4:** parcurge `hu.ts` și confirmă că nicio valoare nu mai e engleză. Nu există linter automat pentru catalogul mobil (e TypeScript, nu JSON) — verificarea e vizuală, pe namespace-uri.

---

### Task 4.6: Scoate hardcodările românești din codul mobil

Chiar cu catalogul complet, string-urile astea rămân românești pe un telefon maghiar, pentru că nu trec prin `t()` deloc.

**Fișiere:**
- Modifică: `apps/mobile/src/components/geofence-maker/CreateParcelModal.tsx:24-29`
- Modifică: `apps/mobile/src/lib/location.ts:909-910,1150-1151`
- Modifică: `apps/mobile/src/components/shared/AppModal.tsx:63`
- Modifică: `apps/mobile/src/components/shared/ScreenHeader.tsx:57`
- Modifică: `apps/mobile/src/components/shared/GeofenceOverlay.tsx:60,219,281,340,342,410,422,424`
- Modifică: `apps/mobile/src/i18n/{ro,en,hu}.ts` (chei noi în toate trei)

- [ ] **Pas 1: Mută harta de etichete de culturi în cataloage**

`CreateParcelModal.tsx:24-29` ține `CROP_LABELS` în afara catalogului, într-un fișier care **deja importă `useI18n`**. Adaugă în toate trei cataloagele, sub `parcel`:

```ts
    cropType: {
      grau: 'Búza',        // ro: 'Grâu',        en: 'Wheat'
      orz: 'Árpa',         // ro: 'Orz',         en: 'Barley'
      rapita: 'Repce',     // ro: 'Rapiță',      en: 'Rapeseed'
      plante_nutret: 'Takarmánynövény', // ro: 'Plante de nutreț', en: 'Fodder crops'
      altele: 'Egyéb',     // ro: 'Altele',      en: 'Other'
    },
```

apoi înlocuiește `CROP_LABELS[x]` cu `t(\`parcel.cropType.${x}\`)`. **Cheile rămân valorile românești stocate în enum-ul din baza de date** — nu le redenumi.

- [ ] **Pas 2: Tradu notificarea permanentă din bara de stare**

`location.ts:909-910` și **din nou** la 1150-1151 — același text în două locuri. E string-ul cel mai văzut din toată aplicația.

```ts
        notificationTitle: tStatic('trackingSetup.fgsTitle'),
        notificationBody: tStatic('trackingSetup.fgsBody'),
```

Chei noi (`trackingSetup`): HU `'StrawBoss — helymeghatározás aktív'` / `'A pozíciót továbbítjuk a diszpécsernek.'`; RO textul actual; EN `'StrawBoss — location active'` / `'Sending your position to the dispatcher.'`.

> Folosește `tStatic`, nu `useI18n` — codul ăsta rulează în afara arborelui React.

- [ ] **Pas 3: Repară parametrul implicit care scurge română peste tot**

`AppModal.tsx:63` are `cancelText = 'Anulează'` ca **valoare implicită de parametru**, deci se scurge în fiecare loc de apel care îl omite:

```tsx
  cancelText,
  // …
  {cancelText ?? t('common.cancel')}
```

- [ ] **Pas 4: Restul literalelor**

`ScreenHeader.tsx:57` `'Înapoi'` → `t('common.back')` (e pe aproape fiecare ecran). Cele 8 din `GeofenceOverlay.tsx` → chei noi sub `geofenceMap`. Verifică și `useGeofenceNotifications.ts:242-369` (9× fallback `'Câmp'`), `inactivity-alarm.ts:121-122`, `SignatureCapture.tsx:43/49`, `NumericPad.tsx:58/60`, `NotificationBell.tsx:23`, `ActionCard.tsx:71`, `SyncManager.ts:170`, `useTripTransition.ts:85`, `routing.ts:109`.

- [ ] **Pas 5: Verifică și confirmă paritatea**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck mobile
```

Anotarea `TranslationKeys` garantează că orice cheie adăugată în `ro.ts` dar uitată în `en.ts`/`hu.ts` e eroare de compilare.

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/mobile/src
git commit -m "fix(mobile): scot literalele românești din afara cataloagelor

Notificarea permanentă din bara de stare (hardcodată în DOUĂ locuri în
location.ts), harta de etichete de culturi ținută în afara catalogului, și
'Anulează' ca VALOARE IMPLICITĂ de parametru în AppModal — se scurgea în fiecare
loc de apel care o omitea. Toate rămâneau românești pe un telefon maghiar
oricât de complet ar fi fost catalogul.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faza 5 — Formatarea conștientă de limbă

Traducerea textului nu ajunge: un utilizator maghiar cu interfața în maghiară ar primi **date în format american**, pentru că cele șase ternare de pe web au forma `locale === 'ro' ? 'ro-RO' : 'en-US'` și a treia limbă cade pe ramura `else`.

---

### Task 5.1: Un singur hook de formatare pe web

**Fișiere:**
- Creează: `apps/admin-web/src/lib/use-locale-format.ts`
- Modifică: `apps/admin-web/src/lib/date.ts:65,78`
- Modifică: `DevicePresenceDot.tsx:46`, `UserPresenceDot.tsx:54`, `reports/FieldReportTab.tsx:35`, `reports/page.tsx:88`, `tasks/daily-plan/DayNavigator.tsx:19`, `deposits/page.tsx:46`

- [ ] **Pas 1: Exportă constanta de fus orar**

`apps/admin-web/src/lib/date.ts:11` are `const ROMANIA_TZ = 'Europe/Bucharest';` — **fără `export`**. Adaugă-l:

```ts
export const ROMANIA_TZ = 'Europe/Bucharest';
```

- [ ] **Pas 2: Scrie hook-ul**

```ts
'use client';

import { useMemo } from 'react';
import { LOCALE_BCP47 } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { ROMANIA_TZ } from '@/lib/date';

/**
 * Formatare de dată și număr conștientă de limbă.
 *
 * Înlocuiește șase ternare `locale === 'ro' ? 'ro-RO' : 'en-US'` împrăștiate prin
 * aplicație. Ternarele alea aveau exact două ramuri, deci a treia limbă cădea
 * tăcut pe formatul american — dată MM/DD/YYYY și grupare 1,234.56 într-o
 * interfață altfel maghiară. Un al treilea braț în șase locuri ar fi doar amânat
 * problema; asta o închide.
 *
 * Fusul rămâne Europe/Bucharest: limba interfeței nu mută operațiunea.
 */
export function useLocaleFormat() {
  const { locale } = useI18n();

  return useMemo(() => {
    const tag = LOCALE_BCP47[locale];
    return {
      /** Eticheta BCP-47 brută, pentru apelurile toLocale* care nu pot folosi un Intl gata făcut. */
      tag,
      date: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      dateTime: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      time: new Intl.DateTimeFormat(tag, {
        timeZone: ROMANIA_TZ,
        hour: '2-digit',
        minute: '2-digit',
      }),
      number: new Intl.NumberFormat(tag),
      /** Comparator de sortare — maghiara are digrafe (cs, dz, gy, ly, ny, sz, ty, zs) și ő/ű. */
      compare: new Intl.Collator(tag, { sensitivity: 'base' }).compare,
    };
  }, [locale]);
}
```

> Verifică numele exact exportat pentru fusul orar în `apps/admin-web/src/lib/date.ts` și importă-l corect.

- [ ] **Pas 3: Înlocuiește cele șase ternare**

În fiecare din cele șase fișiere: `const fmt = useLocaleFormat();`, apoi `new Date(x).toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-US')` → `fmt.dateTime.format(new Date(x))`.

- [ ] **Pas 4: Repară `date.ts`, care nu citea deloc limba**

`fmtDate` (65) și `fmtDateTime` (78) hardcodează `Intl.DateTimeFormat('ro-RO', …)` — **utilizatorii englezi primesc deja date românești azi**. Adaugă un parametru opțional de limbă cu valoarea implicită `DEFAULT_LOCALE` și trimite `fmt.tag` de la locurile de apel din React.

> **Nu atinge linia 15** (`romaniaDateString`, `Intl.DateTimeFormat('en-GB')`). Ăla e un extractor de componente numerice, niciodată afișat — face aritmetică de zi operațională pe care backend-ul se bazează.

- [ ] **Pas 5: Repară colațiunea**

Cele ~11 apeluri `localeCompare(…, 'ro')` (în `DepositGeofenceModal.tsx:49`, `FarmParcelCascade.tsx:83/86`, `KmlImportToFarmModal.tsx:123`, `accounts/page.tsx:1106`, `parcels/page.tsx:517/521/525/539`, `deposits/page.tsx:224`, `super-admin organizations/[id]/users/page.tsx:753`) → `fmt.compare(a, b)`.

- [ ] **Pas 6: Confirmă că nu mai există ternare**

```bash
cd /srv/apps/Strawboss
grep -rn "ro-RO'\s*:\s*'en-US\|'ro-RO'" apps/admin-web/src/ | grep -v "lib/date.ts" ; echo "(gol = curat)"
./strawboss.sh typecheck admin-web
```

- [ ] **Pas 7: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/admin-web/src
git commit -m "feat(admin-web): un hook de formatare în locul a șase ternare binare

'locale === ro ? ro-RO : en-US' are două ramuri; a treia limbă cădea pe formatul
american — dată MM/DD/YYYY într-o interfață maghiară. Adaug și colațiune corectă
(maghiara are digrafe cs/gy/sz/zs și ő/ű) și repar fmtDate/fmtDateTime, care
hardcodau ro-RO și dădeau deja date românești utilizatorilor englezi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5.2: Formatare conștientă de limbă pe mobil

Mobile-ul e **în urma** web-ului, nu înaintea lui: are **zero** ternare de limbă (verificat — `locale ===` nu apare nicăieri în `apps/mobile/src` sau `app/`). Toate cele cinci formatoare sunt necondiționat `'ro-RO'`, deci utilizatorii englezi primesc deja date românești. Nu există ramură de extins — trebuie introdusă.

**Fișiere:**
- Modifică: `apps/mobile/src/lib/i18n.tsx` (adaugă `dateLocaleFor`)
- Modifică: `useLocationTracking.ts:29`, `TodayActivityCard.tsx:57`, `EnhancedDeliveryFlow.tsx:386`, `ProfileScreen.tsx:363`, `app/daily-report.tsx:36,161`
- Modifică: `apps/mobile/src/lib/point-in-geojson.ts:238`

- [ ] **Pas 1: Adaugă helper-ul lângă normalizator**

În `apps/mobile/src/lib/i18n.tsx`:

```tsx
import { LOCALE_BCP47 } from '@strawboss/types';

/**
 * Eticheta BCP-47 pentru apelurile toLocale*.
 *
 * Mobile-ul n-avea NICIO ramificare pe limbă — toate cele cinci formatoare erau
 * necondiționat 'ro-RO', deci și utilizatorii englezi primeau date românești.
 * Cine caută tiparul de ternar din admin-web va concluziona că mobile-ul e curat
 * și va rata toate cele cinci locuri.
 */
export function dateLocaleFor(locale: Locale): string {
  return LOCALE_BCP47[locale];
}
```

- [ ] **Pas 2: Cablează cele cinci locuri**

În componentele React: `const { locale } = useI18n();` apoi `toLocaleTimeString(dateLocaleFor(locale))`.
În afara React: `dateLocaleFor(normalizeLocale(useAuthStore.getState().locale))`.

- [ ] **Pas 3: Repară raportul zilnic generat**

`app/daily-report.tsx:138` are `<html lang="ro">` hardcodat. Fă-l `<html lang="${locale}">`. Liniile 161 și 222 au două propoziții românești netraduse, deși restul fișierului folosește `t()` în 33 de locuri — adaugă-le în cataloage.

> Același `<html lang="ro">` există în `src/map/leaflet-map-content.ts:12` și `leaflet-geofence-editor.ts:6`. Sunt containere de hartă fără text — schimbă atributul pentru corectitudine, dar nu e vizibil.

- [ ] **Pas 4: Colațiune**

`point-in-geojson.ts:238` — `localeCompare(b.name)` fără argument. Trimite eticheta de limbă.
> `useTodayActivity.ts:195` compară string-uri ISO — **lasă-l așa**, e sortare de date, nu de text.

- [ ] **Pas 5: Verifică**

```bash
cd /srv/apps/Strawboss
grep -rn "'ro-RO'" apps/mobile/src apps/mobile/app | grep -v "lib/date.ts" ; echo "(gol = curat)"
./strawboss.sh typecheck mobile
```

> **Nu atinge `apps/mobile/src/lib/date.ts:14` și `:39`** (`'en-GB'` cu `formatToParts`) — e substratul de parsare pentru aritmetica de zi operațională pe `Europe/Bucharest`, aceeași pe care o folosește și dashboard-ul.

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add apps/mobile/src apps/mobile/app
git commit -m "feat(mobile): formatare de dată conștientă de limbă

Mobile-ul n-avea nicio ramificare pe limbă — cele cinci formatoare erau
necondiționat ro-RO, deci și utilizatorii englezi primeau deja date românești.
Introduc ramura prin dateLocaleFor().

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faza 6 — Backend

Backend-ul **stochează** limba, dar n-o **citește** niciodată. `RequestUser` (`auth.guard.ts:34`) nu duce câmpul, nu există dependință de i18n, nu se tratează `Accept-Language`, iar fiecare din cele ~19 titluri de push, 8 tipuri de email/SMS și 2 template-uri Handlebars e un literal la locul emiterii.

---

### Task 6.1: Trece limba prin auth guard

Fără asta, niciun endpoint, job sau notificare nu poate ști ce limbă vorbește destinatarul.

**Fișiere:**
- Modifică: `backend/service/src/auth/auth.guard.ts:26-34` și interogarea de utilizator

- [ ] **Pas 1: Adaugă câmpul în context**

În `UserContext` și `RequestUser`:

```ts
  /** Limba de interfață a utilizatorului. Vine pe join-ul pe care guard-ul îl face oricum. */
  locale: Locale;
```

- [ ] **Pas 2: Selectează coloana**

Găsește interogarea de utilizator din guard și adaugă `locale` în lista de coloane. **Călărește join-ul users/organizations deja existent**, în spatele aceluiași cache cu TTL + generație care ține `disabledFeatures` și `activeSeasonYear` — nu adaugă nicio interogare.

Normalizează la citire: `locale: normalizeLocale(row.locale)`.

- [ ] **Pas 3: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck backend
```

- [ ] **Pas 4: Tradu și cele două erori de autentificare**

`auth.guard.ts:293` și `:296` aruncă românește (`'Cont inexistent sau șters'`, `'Cont inactiv'`), în timp ce 215/279/319 aruncă englezește. Lasă-le pe toate în engleză pentru moment și notează-le pentru Task 6.4 — nu le traduce individual.

- [ ] **Pas 5: Commit**

```bash
cd /srv/apps/Strawboss
git add backend/service/src/auth
git commit -m "feat(auth): RequestUser duce acum locale

Backend-ul stoca limba, dar n-o citea niciodată — nici un endpoint, job sau push
nu putea ști în ce limbă vorbește destinatarul. Coloana călărește join-ul pe care
guard-ul îl face oricum, în spatele aceluiași cache: zero interogări în plus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6.2: Runtime i18n de server + notificările push

`sendPush(userId, title, body, data)` (`notifications.service.ts:95`) e **singurul punct prin care trec toate cele ~19 push-uri vizibile**, și are deja `userId`-ul. Convertirea semnăturii la `(key, params)` e schimbarea cu cel mai mare efect din tot backend-ul.

**Fișiere:**
- Creează: `backend/service/src/common/i18n/index.ts`
- Creează: `backend/service/src/common/i18n/catalogs/{en,ro,hu}.ts`
- Modifică: `backend/service/src/notifications/notifications.service.ts:95,268-269,292-293,517,520-521,545-546,576-577,614-618,776-777`
- Modifică: `backend/service/src/notifications/simulate-push-templates.ts`

- [ ] **Pas 1: Scrie runtime-ul**

```ts
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from '@strawboss/types';
import { en } from './catalogs/en.js';
import { ro } from './catalogs/ro.js';
import { hu } from './catalogs/hu.js';

export type ServerCatalog = typeof en;

const catalogs: Record<Locale, ServerCatalog> = { en, ro, hu };

/**
 * Traduce un text de server (push, email, SMS, etichetă de PDF).
 *
 * Backend-ul n-avea deloc i18n: fiecare string era un literal la locul emiterii,
 * ceea ce însemna că limba destinatarului n-avea unde să intre. Aici e singurul
 * loc de randare.
 */
export function tServer(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const loc = normalizeLocale(locale);
  const raw =
    getByPath(catalogs[loc], key) ??
    getByPath(catalogs[DEFAULT_LOCALE], key) ??
    getByPath(catalogs.en, key);
  if (typeof raw !== 'string') return key;
  return params
    ? raw.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
    : raw;
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, p) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[p];
  }, obj);
}
```

Cataloagele urmează tiparul mobil: `export const en = { push: { … }, email: { … }, sms: { … }, pdf: { … } } as const;` cu `ro`/`hu` anotate `: typeof en` ca paritatea să fie garantată la compilare.

- [ ] **Pas 2: Extrage cele 19 push-uri în chei**

Parcurge locurile de apel listate mai sus, mută fiecare string românesc într-o cheie sub `push.*` în catalogul `ro`, tradu în `en` și `hu`.

- [ ] **Pas 3: Schimbă semnătura**

```ts
async sendPush(
  userId: string,
  key: string,
  params?: Record<string, string | number>,
  data?: Record<string, unknown>,
): Promise<void> {
  const locale = await this.localeForUser(userId);
  const title = tServer(locale, `${key}.title`, params);
  const body = tServer(locale, `${key}.body`, params);
  // … restul neschimbat
}
```

`localeForUser` citește `users.locale` (memorează în cache — push-urile se emit în rafale către mai mulți destinatari).

- [ ] **Pas 4: Adaugă dimensiunea de limbă la `simulate-push-templates.ts`**

`EVENT_TEMPLATES` sunt 9 evenimente × (titlu + corp) = 18 string-uri românești, deja într-un record cu chei. Aceeași restructurare.

- [ ] **Pas 5: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck backend
grep -rn "sendPush(" backend/service/src/ | wc -l
```

Confirmă că fiecare loc de apel a fost migrat — semnătura veche nu mai compilează, deci typecheck-ul e garanția.

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add backend/service/src/common/i18n backend/service/src/notifications
git commit -m "feat(backend): runtime i18n de server + push-uri localizate

sendPush era singurul punct prin care trec toate notificările și avea deja
userId-ul — dar primea string-uri românești pre-randate. Trece la (key, params)
și randează în limba destinatarului.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6.3: Email, SMS și PDF-uri

**Fișiere:**
- Rescrie: `backend/service/src/messaging/message-templates.ts`
- Modifică: `transport-confirmation.processor.ts:181,267`, `aviz-notification.service.ts:159,181`, `trips.service.ts:1462,3512`, `trip-requests.service.ts:761,988`
- Modifică: `backend/service/src/documents/cmr/templates/cmr.hbs`, `cmr.service.ts:176,179,203,208,213`
- Modifică: `backend/service/src/documents/comanda/comanda.service.ts:135,218`

- [ ] **Pas 1: Adaugă dimensiunea de limbă la șabloanele de mesaje**

`message-templates.ts` are 389 de linii, 8 tipuri de mesaj, 100% românește (antetul fișierului o spune explicit la linia 5), cu semnătura `messageTemplates[kind](ctx)` fără parametru de limbă. Restructurează la `messageTemplates[kind][locale](ctx)` și actualizează cele 8 locuri de apel statice.

- [ ] **Pas 2: Parametrizează etichetele CMR**

`cmr.hbs` are ~29 de etichete românești hardcodate în markup (`'SCRISOARE DE TRANSPORT CMR'`, `'1. EXPEDITOR'`, `'Nr. baloți'`, `'Greutate brută (kg)'`, `'Tară camion (kg)'`, `'ȘOFER / TRANSPORTATOR'`, `'PRIMITOR'`). Niciuna nu e `{{lookup}}`.

Transmite un obiect `labels` din service (`cmr.service.ts:176`, unde se apelează `this.template({…})`), construit cu `tServer(locale, 'pdf.cmr.*')`, și înlocuiește fiecare etichetă cu `{{labels.expeditor}}` etc.

> Sigla `CMR` rămâne `CMR` în toate limbile. Titlul maghiar: `'CMR FUVARLEVÉL'`.

- [ ] **Pas 3: Repară cele patru formatări de dată necondiționate**

`cmr.service.ts:179,203,208,213` sunt `toLocaleDateString('ro-RO')` / `toLocaleString('ro-RO')` fără nicio ramificație. Introdu ramura folosind `LOCALE_BCP47[locale]`. Idem `comanda.service.ts:135`, și titlul documentului de la 218 (`Comandă ${orderNo}`).

- [ ] **Pas 4: Comanda — lasă clauzele juridice în pace**

`comanda.hbs:67-68` conțin conținut de drept românesc:
- `'Plata facturii se va face la cursul BNR din ziua facturii.'` (BNR = Banca Națională a României)
- `'Vă rugam sa ne trimiteți asigurarea CMR.'`

**Traduce etichetele din jur, dar lasă aceste două propoziții în română**, cu un comentariu în șablon care explică de ce. O comandă maghiară e o întrebare juridică, nu una de traducere.

- [ ] **Pas 5: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck backend
```

- [ ] **Pas 6: Commit**

```bash
cd /srv/apps/Strawboss
git add backend/service/src/messaging backend/service/src/documents
git commit -m "feat(backend): email, SMS și PDF localizate

message-templates.ts era catalogul de-facto monolingv al backend-ului (389 linii,
8 tipuri, 100% română). Primește o dimensiune de limbă. Etichetele CMR trec prin
labels transmise din service. Clauzele de drept românesc din comandă (cursul BNR,
asigurarea CMR) rămân în română — conținut juridic, nu traducere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6.4: Erorile HTTP văzute de operator

~339 de mesaje aruncate, din care doar ~22 poartă un cod `error:` stabil, citibil de mașină. Nu le traducem pe toate — traducem pe cele pe care **operatorul chiar le vede**.

**Fișiere:**
- Modifică: `backend/service/src/common/pipes/zod-validation.pipe.ts:46`
- Modifică: `backend/service/src/common/filters/all-exceptions.filter.ts:77`
- Modifică: `backend/service/src/seasons/seasons.service.ts:203`

- [ ] **Pas 1: Repară cea mai traficată cale de eroare**

`zod-validation.pipe.ts:46` are fallback-ul românesc `'Date invalide.'`, dar **înfășoară mesajele proprii ale lui Zod, care sunt în engleză** — un câmp greșit apare pe un telefon românesc ca `baleCount: Expected number, received string`. E calea de eroare a fiecărui endpoint de scriere, și nu e configurat niciun `errorMap` de Zod nicăieri în backend.

Trimite `tServer(user?.locale, 'errors.invalidData')` și nu mai concatena mesajul brut de la Zod în textul văzut de utilizator — pune-l în `details`, pentru log.

> Amintește-ți contextul: `ZodValidationPipe` a ascuns odată **toate** erorile de validare ca „Internal server error" și a blocat singurul încărcător din câmp timp de 6 zile. Testează schimbarea asta cu un payload invalid real înainte de commit.

- [ ] **Pas 2: Traduce cele două chokepoint-uri**

`all-exceptions.filter.ts:77` (`'Cerere invalidă.'`) — e singurul punct de trecere al erorilor HTTP, deci fiecare client din fiecare limbă îl primește.
`seasons.service.ts:203` (`'Sezonul … este închis'`) — clasificat ca terminal de `sync/push.ts` din mobil și afișat **verbatim** operatorului.

- [ ] **Pas 3: Verifică**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh typecheck backend
```

- [ ] **Pas 4: Commit**

```bash
cd /srv/apps/Strawboss
git add backend/service/src/common backend/service/src/seasons
git commit -m "feat(backend): localizez erorile pe care operatorul chiar le vede

ZodValidationPipe avea fallback românesc, dar înfășura mesajele ENGLEZE ale lui
Zod — un câmp greșit apărea ca 'baleCount: Expected number, received string' pe
un telefon românesc. Plus cele două chokepoint-uri: filtrul global de excepții și
eroarea de sezon închis, pe care mobile-ul o afișează verbatim.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6.5: Colațiune în rapoarte

**Fișiere:** `backend/service/src/reports/reports.service.ts:179`

- [ ] **Pas 1:** `a.farmName.localeCompare(b.farmName)` n-are argument de limbă → sortează după limba ICU implicită a containerului. Trimite `LOCALE_BCP47[locale]`.
- [ ] **Pas 2:** `./strawboss.sh typecheck backend`
- [ ] **Pas 3:** Commit.

---

## Faza 7 — Verificare și livrare

---

### Task 7.1: Verificare integrală înainte de deploy

- [ ] **Pas 1: Toate verificările**

```bash
cd /srv/apps/Strawboss
./strawboss.sh build packages
./strawboss.sh typecheck types && ./strawboss.sh typecheck validation && ./strawboss.sh typecheck api
./strawboss.sh typecheck backend && ./strawboss.sh typecheck admin-web && ./strawboss.sh typecheck mobile
./strawboss.sh lint
cd apps/admin-web && node scripts/check-i18n-parity.mjs && node scripts/check-i18n-interpolation.mjs
```

Așteptat: totul verde, iar linterul spune `i18n: 3 cataloage în paritate (2189 chei fiecare)`.

- [ ] **Pas 2: Dovedește că enum-ul COMPILAT acceptă `hu`**

```bash
cd /srv/apps/Strawboss
grep -rn "hu" packages/validation/dist/schemas/profile.schema.js
grep -rn "hu" packages/types/dist/locale.js
```

Ambele trebuie să conțină `hu`. Dacă nu, `dist/` e vechi — re-rulează `build packages`.

- [ ] **Pas 3: Confirmă că nu mai există literale de limbă**

```bash
cd /srv/apps/Strawboss
grep -rn "'en' | 'ro'\|'ro' | 'en'\|\['ro', *'en'\]" \
  packages/*/src backend/service/src apps/admin-web/src apps/mobile/src
echo "(gol = toate cele 17 uniuni și 5 pickere migrate)"
```

- [ ] **Pas 4: Commit final și push**

```bash
cd /srv/apps/Strawboss
git add -A && git commit -m "chore(i18n): verificare finală pentru limba maghiară" || true
git push origin main
```

> Push-ul **trebuie** să se întâmple înainte de deploy: imaginile Swarm sunt etichetate cu short-SHA-ul git, iar modificările necommit-uite produc aceeași etichetă și un `strawboss.sh prod` care face silențios no-op.

---

### Task 7.2: Deploy, în ordinea obligatorie

Ordinea nu e negociabilă. Enum-ul de runtime trăiește în copia de `@strawboss/validation` a **backend-ului**, nu în clienți. Dacă admin-web sau mobilul livrează pickerul maghiar înainte ca backend-ul să fie redeployat, fiecare comutare pe `hu` dă 400 — istoric, apărut ca un opac „Internal server error".

- [ ] **Pas 1: Backend întâi**

```bash
cd /srv/apps/Strawboss && ./strawboss.sh prod
```

- [ ] **Pas 2: Verifică pe viu că serverul acceptă `hu`**

Ca admin, în admin-web, schimbă limba unui cont de test pe maghiară și confirmă în baza de date că `users.locale` chiar spune `hu`. Dacă UI-ul zice că s-a salvat dar coloana nu s-a schimbat, `dist/`-ul din imaginea live e vechi — vezi capcana de la Task 1.2 Pasul 5.

- [ ] **Pas 3: Admin-web**

Utilizatorul construiește UI-ul. Predă-i-l cu instrucțiunea de a verifica: comută pe maghiară, reîncarcă pagina, confirmă că **rămâne** maghiară (asta testează reparația de `readStoredLocale` din Task 1.4), apoi deschide Setări și salvează un câmp fără legătură, confirmând că limba **nu** se resetează (asta testează linia de pierdere de date).

- [ ] **Pas 4: Mobil — ultimul, și o singură dată**

Bump `android.versionCode` în `apps/mobile/app.json` (de la 57 la 58) și `version`. Apoi build APK.

> Nu există `expo-updates`. Nu există OTA doar-JS. Un `hu.ts` incomplet costă un ciclu întreg de build + rollout pe flotă. **Confirmă că Faza 4 e integral terminată înainte de pasul ăsta.**

- [ ] **Pas 5: Verificare pe un telefon real**

Setează un cont de test pe `hu` din admin-web, forțează o sincronizare pe telefon, confirmă că interfața se schimbă. Dacă rămâne **românească**, `normalizeLocale` din Task 4.1 n-a ajuns în build — ăsta e exact eșecul tăcut pe care planul e construit să-l prevină.

---

### Task 7.3: Actualizează baza de cunoștințe

- [ ] **Pas 1:** Rulează `/strawboss-sync-docs`.

> **Constrângere:** sincronizarea de documentație rulează pe `claude-sonnet-5` la efort înalt, niciodată pe Opus.

- [ ] **Pas 2:** Confirmă că `.claude/docs/hot.md` menționează SSOT-ul de limbi și că `log.md` are o intrare pentru maghiară.

---

## Auto-verificarea planului

**Acoperirea scopului.** Interfață web → Fazele 1, 3, 5. Interfață mobilă → Fazele 1, 4, 5. Push → Task 6.2. Email/SMS → Task 6.3. PDF/CMR → Task 6.3. Instalația (DB, enum-uri, pickere) → Faza 1. Toate cele patru părți de scop confirmate au un task.

**Ieșirile din scop sunt declarate**, nu omise: retroactivul textului salvat, fusul orar, string-urile native Android, clauzele juridice — fiecare cu motivul, în tabelul de Constrângeri globale.

**Consecvența de tipuri.** `Locale`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `LOCALE_ENDONYMS`, `LOCALE_BCP47`, `isLocale`, `normalizeLocale` sunt definite o dată în Task 1.1 și folosite cu aceleași nume în Taskurile 1.2–1.5, 4.1, 5.1, 5.2, 6.1, 6.2, 6.5. `tServer` e definit în 6.2 și folosit în 6.3, 6.4. `useLocaleFormat` e definit în 5.1 și folosit doar acolo. `dateLocaleFor` e definit în 5.2 și folosit doar acolo.

**Build-ul nu trece niciodată prin roșu.** Taskurile 1.4 și 4.1 bifurcă fișierul de catalog *înainte* de a-l cabla, în același commit — `Record<Locale, …>` e proiectat să rupă compilarea fără el, și e singurul eșec *zgomotos* din tot lanțul (toate celelalte moduri de eșec ale acestui feature sunt tăcute). Fișierul bifurcat e englezesc ca text; linterul de cataloage rămâne roșu până la sfârșitul Fazei 3, ceea ce e o stare diferită și corectă — compilarea trece, traducerea e incompletă și vizibilă.

**Numere verificate direct**, nu preluate: 2183 de chei web (rulând scriptul de paritate existent), 1123 mobil, 46 respectiv 33 de namespace-uri. Faza 0 adaugă 6 chei → 2189. Total tradus: **3312**.
