# Orchestration Overview — Tascuri.txt 3-Plan Parallel Execution

> **Sursă:** `/srv/apps/Strawboss/tascuri.txt` (18 task-uri user-facing, în română)
> **Strategie:** 3 planuri paralele executate de 3 agenți Opus 4.7 separați (1 plan / agent / branch)
> **Total LoC plan:** 4086 linii markdown (973 + 1412 + 1701)
> **Data:** 2026-05-24

---

## 1. De ce 3 planuri (nu 2, nu 4)

| Criteriu | 2 planuri | **3 planuri (ales)** | 4 planuri |
|---|---|---|---|
| Paralelism wall-clock | 2× | **3×** | 4× |
| Conflicte git pe fișiere comune | mici | **mici (controlate)** | mari (DB migr. devine singleton) |
| Task-uri / plan | 9 | **6-7** | 4-5 |
| Coordonare necesară | redusă | **medie (3 contracte)** | mare (4 sincronizări) |

**Verdict:** 3 planuri = **sweet spot** între paralelism și overhead de coordonare. Migrațiile DB sunt singura resursă rară (un fișier per plan, numere rezervate distinct).

---

## 2. Maparea task-urilor → planuri

| Task | Descriere scurtă | **Plan** |
|---|---|---|
| T1 | Picker punct cu pin rotund central + buton "Adaugă punct" lateral dreapta (păstrăm satelit 2D actual, NU 3D Earth) — folosit în geofence-maker + profile mobile | **A** |
| T2 | Sidebar-uri map admin colapsabile / compacte | **A** |
| T3 | Buton "Add deposit" cu `+` ca la "Add parcel" | **A** |
| T4 | Vezi în admin tasks cine e conectat (presence) | **C** |
| T5 | Pe baler home: tap parcelă → ecran detaliu parcelă | **B** |
| T6 | Geofence baler: enter cu 10 s confirm + exit cu producție + partial/total + sunet tare | **B** |
| T7 | Ierarhie status: `harvested` nu se mai întoarce la `partial` | **B** |
| T8 | Locații mobile (GPS) live pe harta admin | **A** |
| T9.1 | Crop type (grâu/orz/rapiță/plante nutreț) | **B** |
| T9.2 | Scoatem `is_active` pe parcele | **B** |
| T9.3 | Numele parcelei = doar numărul (`code`) | **B** |
| T9.10 | Status flow extins: planned → harvesting → partial/harvested → in_loading → loaded → completed | **B** |
| T11 | KML import în tab-ul Farms cu auto-assign la fermă | **A** |
| T12 | Cont depozit pe mobile: inventar + curse care vin | **C** |
| T13 | Cursă multi-iterație: counter de baloți + recall loader | **C** |
| T14 | Notificare loader după descărcare + alertă admin la truck idle | **C** |
| T15 | Mai multe curse pe camion pe zi în admin tasks | **C** |
| T16 | Buton "Deschide Google Maps" către loader pe driver mobile | **A** |
| T17 | Combustibil = doar litri + poză la final | **C** |
| T18 | Raport km/camion/zi din GPS line | **A** |

### Distribuție efort
- **Plan A** — 7 task-uri (T1, T2, T3, T8, T11, T16, T18) — **973 linii** — ~7 zile
- **Plan B** — 7 task-uri (T5, T6, T7, T9.1, T9.2, T9.3, T9.10) — **1412 linii** — ~3 zile (focus DB + mobile geofence UX)
- **Plan C** — 6 task-uri (T4, T12, T13, T14, T15, T17) — **1701 linii** — ~4-5 zile (cel mai mare scope backend)

---

## 3. File ownership matrix (cross-plan)

Tabelul de mai jos arată **cine deține ce** și **de ce nimeni altcineva nu atinge**. Conflictele git sunt eliminate prin design.

| Zonă | Plan A | Plan B | Plan C |
|---|:---:|:---:|:---:|
| `supabase/migrations/00042_*.sql` | – | ✅ owner | – |
| `supabase/migrations/00043_*.sql` | – | – | ✅ owner |
| `supabase/migrations/00044_*.sql` | reserved | – | – |
| `packages/types/src/entities/parcel.ts` | – | ✅ owner | – |
| `packages/types/src/entities/trip.ts` | – | – | ✅ owner |
| `packages/types/src/entities/user.ts` | – | – | ✅ owner |
| `packages/validation/src/schemas/parcel.schema.ts` | – | ✅ owner | – |
| `packages/validation/src/schemas/trip.schema.ts` | – | – | ✅ owner |
| `packages/validation/src/schemas/user.schema.ts` | – | – | ✅ owner |
| `backend/service/src/parcels/**` | – | ✅ owner | calls helper |
| `backend/service/src/trips/**` | – | – | ✅ owner |
| `backend/service/src/task-assignments/**` | – | – | ✅ owner |
| `backend/service/src/geofence/**` | – | ✅ owner | – |
| `backend/service/src/notifications/notifications.service.ts` | – | adds 2 helpers | adds 2 helpers |
| `backend/service/src/notifications/notifications.controller.ts` | – | extends `/confirm-parcel-done` + new `/confirm-parcel-entry` | adds `/loader-recall-response` |
| `backend/service/src/location/**` | ✅ owner (km/day) | – | – |
| `backend/service/src/fuel-logs/**` | – | – | ✅ owner |
| `backend/service/src/deposit-inventory/**` (NEW) | – | – | ✅ owner |
| `backend/service/src/jobs/**` | – | – | ✅ owner (idle BullMQ) |
| `backend/service/src/sync/sync.service.ts` | – | adds `crop_type` to allowlist | adds `parent_trip_id`, `iteration_index` |
| `apps/admin-web/src/app/[slug]/(dashboard)/map/**` | ✅ owner | – | – |
| `apps/admin-web/src/components/map/**` | ✅ owner | – | – |
| `apps/admin-web/src/lib/realtime.tsx` | ✅ owner | – | – |
| `apps/admin-web/src/lib/kml-parser.ts` | uses (read-only) | – | – |
| `apps/admin-web/src/app/[slug]/(dashboard)/farms/**` | ✅ owner | – | – |
| `apps/admin-web/src/app/[slug]/(dashboard)/deposits/**` | ✅ owner | – | – |
| `apps/admin-web/src/app/[slug]/(dashboard)/parcels/**` | – | ✅ owner | – |
| `apps/admin-web/src/app/[slug]/(dashboard)/tasks/**` | – | – | ✅ owner |
| `apps/admin-web/src/app/[slug]/(dashboard)/reports/**` | ✅ owner (km/day tab) | – | – |
| `apps/admin-web/messages/{en,ro}.json` | adds `map.*`, `farms.*`, `deposits.*`, `reports.kmPerTruck.*` | adds `parcels.crop.*`, `parcels.harvest.*` | adds `tasks.online.*`, `tasks.truck.iterations.*` |
| `apps/mobile/app/(geofence-maker)/**` | ✅ owner | – | – |
| `apps/mobile/app/(baler)/**` | – | ✅ owner | – |
| `apps/mobile/app/baler-ops/**` | – | ✅ owner | – |
| `apps/mobile/app/(driver)/**` | **🔶 shared** (vezi §4) | – | ✅ owner (structural) |
| `apps/mobile/app/(loader)/**` | – | – | ✅ owner |
| `apps/mobile/app/driver-ops/**` | – | – | ✅ owner |
| `apps/mobile/app/(deposit)/**` (NEW) | – | – | ✅ owner |
| `apps/mobile/app/_layout.tsx` | – | – | ✅ owner (adaugă `depot_manager` în ROLE_ROUTES) |
| `apps/mobile/src/components/map/**` | ✅ owner | – | – |
| `apps/mobile/src/components/features/production/**` | – | ✅ owner | – |
| `apps/mobile/src/components/features/fuel/**` | – | – | ✅ owner |
| `apps/mobile/src/components/features/delivery/**` | – | – | atinge minim doar dacă necesar |
| `apps/mobile/src/components/shared/GeofenceOverlay.tsx` | – | ✅ owner | – |
| `apps/mobile/src/hooks/useGeofenceNotifications.ts` | – | ✅ owner | – |
| `apps/mobile/src/db/schema.ts` | – | adaugă `crop_type` pe parcels | adaugă `parent_trip_id`, `iteration_index` pe trips |
| `apps/mobile/src/db/migrations.ts` | – | local migration crop_type | local migration trips + deposit cache |
| `apps/mobile/src/components/ProfileScreen.tsx` | ✅ owner (PointPicker home) | – | – |

**Concluzie:** Singura zonă **partajată** este `apps/mobile/app/(driver)/index.tsx` (Plan A adaugă un subcomponent mic, Plan C face restructurarea). Soluția în §4.

---

## 4. Zone partajate și soluții de coexistență

### 4.1 `apps/mobile/app/(driver)/index.tsx` — Plan A + Plan C

**Problem:** Plan A vrea să adauge `<OpenMapsToLoaderButton tripId={item.id} />` pe fiecare trip card. Plan C restructurează lista pentru multi-iteration counter.

**Soluție (contract):** Plan C definește un marker-comment în JSX-ul trip card:
```tsx
{/* @plan-a:open-maps-button-slot */}
{/* @plan-a:end */}
```
Plan A își pune butonul ÎNTRE markeri. Cele două commit-uri pot fi merse în orice ordine fără conflict de merge (regiunea Plan A e izolată, regiunea Plan C e în afara markerilor).

**Ordine de merge recomandată:** Plan C primul (face restructurarea + adaugă markerii), apoi Plan A (umple slot-ul). Dacă Plan A merge primul, va păstra zona inițială și Plan C va păstra slot-ul în restructurare.

### 4.2 `backend/service/src/notifications/notifications.service.ts` — Plan B + Plan C

**Problem:** Ambele planuri adaugă helper-i noi.

**Soluție (contract):**
- Plan B adaugă **exclusiv**: `sendBalerFieldEntryConfirm()`, `sendBalerFieldExitProduction()`
- Plan C adaugă **exclusiv**: `sendTruckUnloadedLoaderPrompt()`, `sendTruckIdleAdminAlert()`
- Helper-ii existenți (ex. `sendGeofenceExitNotification`) nu se modifică.

Ambele planuri adaugă funcții noi la finalul fișierului — fără conflict de linii.

### 4.3 `backend/service/src/notifications/notifications.controller.ts` — Plan B + Plan C

Similar §4.2:
- Plan B: extinde `POST /notifications/confirm-parcel-done` (adaugă `finishState`) + adaugă `POST /notifications/confirm-parcel-entry`.
- Plan C: adaugă `POST /notifications/loader-recall-response`.

Nu ating aceleași handler-e.

### 4.4 `apps/mobile/src/db/schema.ts` + `migrations.ts`

Fiecare plan adaugă propriile coloane în propriile migrații **incrementale** (`addColumnIfMissing`). Dacă agenții lucrează pe branch-uri separate, conflictul apare doar la merge — rezolvat prin renumărotarea migrațiilor locale.

### 4.5 `backend/service/src/sync/sync.service.ts` — ambele planuri B + C

Ambele adaugă coloane în `ALLOWED_COLUMNS`. Fișier mic, conflict trivial de rezolvat. Recomandare: după primul merge, al doilea PR rezolvă conflictul în 30 sec.

---

## 5. Contracte de interfață between plans

### 5.1 Plan B → Plan C: `parcelsService.advanceHarvestOnLoadEvent`

**Owner:** Plan B (definește în `backend/service/src/parcels/parcels.service.ts`)
**Consumer:** Plan C (apelează în `trips.service.ts` la transitions `start-loading`, `complete-loading`, `complete`)

```typescript
// Plan B exportă această semnătură:
async advanceHarvestOnLoadEvent(
  parcelId: string,
  event: 'loading_started' | 'all_loaded' | 'all_delivered',
  orgId: string,
): Promise<{ previousStatus: HarvestStatus; newStatus: HarvestStatus | null }>
```

**Comportament:**
- `loading_started` → parcel `harvested` sau `partial_harvested` → `in_loading`
- `all_loaded` → parcel `in_loading` → `loaded`
- `all_delivered` → parcel `loaded` → `completed`
- Refuză downgrade (deja garantat de trigger DB; serviciul îl validează duplicat pentru mesaj de eroare clar).

### 5.2 Plan C → Plan A: `useLocationKmByDay` API

**Owner:** Plan A (definește hook + endpoint backend)
**Consumer:** opțional pentru Plan C la rapoarte de cursă multi-iterație (deferred).

### 5.3 Plan A & Plan C: `apps/mobile/app/(driver)/index.tsx`

Vezi §4.1.

### 5.4 Migrații DB: numere rezervate
- **00042** = Plan B (`parcel_crop_and_harvest_extended`)
- **00043** = Plan C (`trip_multi_iteration_and_presence`)
- **00044** = Plan A (rezervat, doar dacă e nevoie pentru raportul km/zi — probabil nu)

---

## 6. Ordine de execuție recomandată

Niciuna dintre planuri nu depinde HARD de alta înainte de start. Dar pentru a maximiza calitatea PR-urilor:

```
Ziua 0 (kickoff)
├── Plan A start (independent — niciun blocker)
├── Plan B start (independent — definește contract pentru Plan C)
└── Plan C start (independent — apelează contract Plan B; folosește stub local până ajunge la integrare)

Ziua 2 (Plan B aproape gata cu helper-ul) → Plan C integrează helper-ul real

Ziua 3 (toate planurile pe finish line)
├── Plan A: PR ready
├── Plan B: PR ready
└── Plan C: PR ready (după ce a apelat helper-ul real de la Plan B)

Ordine de merge sugerată:
1. Plan B (DB + types + validation + parcels — fundamentul)
2. Plan C (rezolvă conflictul mic în sync.service.ts; testează integrare cu Plan B)
3. Plan A (rezolvă conflictul în (driver)/index.tsx via marker-comment)
```

**Alternative:** Plan A poate merge primul fiindcă nu atinge DB. Apoi B și C pot merge în orice ordine.

---

## 7. Kickoff prompt per agent

Fiecare agent Opus 4.7 primește un singur prompt scurt care îl direcționează către planul lui:

### Agent A
```
Citește /srv/apps/Strawboss/.claude/plans/plan-a-map-geofence-experience.md
și /srv/apps/Strawboss/.claude/plans/00-orchestration-overview.md (secțiunile 3, 4, 5).
Apoi execută planul exact, în branch-ul feat/plan-a-map-geofence.
Respectă strict file ownership matrix — nu atinge fișierele marcate "Plan B" sau "Plan C".
La finalul fiecărui task, marchează acceptance criteria ca verificate.
Deschide PR cu titlul "feat: map UI, geofence-maker & fleet tracking (Plan A)".
```

### Agent B
```
Citește /srv/apps/Strawboss/.claude/plans/plan-b-baler-workflow-harvest-status.md
și /srv/apps/Strawboss/.claude/plans/00-orchestration-overview.md (secțiunile 3, 4, 5).
Apoi execută planul exact, în branch-ul feat/plan-b-baler-harvest.
ATENȚIE: trebuie să exporți `parcelsService.advanceHarvestOnLoadEvent()` cu exact
semnătura din §5.1 al overview-ului — Plan C depinde de ea.
Migrația ta = 00042 (numerotare rezervată).
La final, rulează ./strawboss.sh db:migrate local și verifică triggerul anti-downgrade.
Deschide PR cu titlul "feat: baler workflow & harvest status state system (Plan B)".
```

### Agent C
```
Citește /srv/apps/Strawboss/.claude/plans/plan-c-trips-fleet-deposit.md
și /srv/apps/Strawboss/.claude/plans/00-orchestration-overview.md (secțiunile 3, 4, 5).
Apoi execută planul exact, în branch-ul feat/plan-c-trips-fleet.
ATENȚIE:
  - Importă `parcelsService.advanceHarvestOnLoadEvent` (definit de Plan B); dacă nu există
    încă în branch-ul main, stub-uiește local și marchează cu TODO până la integrare.
  - Adaugă marker comments `{/* @plan-a:open-maps-button-slot */}` ... `{/* @plan-a:end */}`
    în apps/mobile/app/(driver)/index.tsx (vezi §4.1 overview).
Migrația ta = 00043.
Deschide PR cu titlul "feat: trip multi-iteration, fleet coordination, deposit & fuel (Plan C)".
```

---

## 8. Verificare post-merge global

După ce toate 3 PR-urile sunt merged în main:

```bash
# 1. Type-check global
pnpm -w typecheck

# 2. Lint global
pnpm -w lint

# 3. Migrațiile aplicate
./strawboss.sh db:migrate
./strawboss.sh db:seed

# 4. Build packages + apps
./strawboss.sh build

# 5. Smoke test local
./strawboss.sh dev
# → vezi că pornește backend + admin-web fără erori
# → vezi că mobile (Expo Go sau APK) se conectează și sync-ul rulează

# 6. Update docs
./strawboss.sh # (sau invocă /strawboss-sync-docs din Claude Code)
```

---

## 9. Riscuri globale & mitigări

| Risc | Probabilitate | Impact | Mitigare |
|---|---|---|---|
| Conflict în `(driver)/index.tsx` la merge Plan A + C | mediu | mic | marker-comments §4.1 |
| Conflict în `sync.service.ts ALLOWED_COLUMNS` Plan B + C | mediu | mic | rezolvare trivială la merge |
| Migrația 00042 (Plan B) crapă în prod la `ALTER TYPE ADD VALUE` (non-tranzacționabilă) | mic | mediu | testează local pe DB clean; foloseste `IF NOT EXISTS` + commit separat pentru enum extension (vezi pattern în 00033) |
| Plan C apelează `advanceHarvestOnLoadEvent` înainte ca Plan B să fie merged → CI fail | mediu | mediu | stub local cu TODO; Plan C merge după Plan B |
| BullMQ idle-check (Plan C) generează false positives în background sleep | mediu | mic | threshold default 30 min + verificare dublă la `task_assignments.status` |
| KML import (Plan A) fără farm selectat la `farms` page → UX broken | mic | mic | modalul forțează selectarea fermei înainte de submit |
| Sunet tare pentru exit baler (Plan B) e enervant în mediu de teren | mic | mediu | configurable din profil; default mediu cu opțiunea LOUD |

---

## 10. Resurse

- **Documentație codebase:** `/srv/apps/Strawboss/.claude/docs/`
- **Skill-uri utile:**
  - `/strawboss-new-migration` — pattern idempotent pentru migrațiile DB
  - `/strawboss-review` — checklist code review
  - `/strawboss-sync-docs` — actualizează docs după merge
  - `/strawboss-bug-hunt` — rulează review multi-agent înainte de merge
- **Convenții generale:** vezi `/srv/apps/Strawboss/CLAUDE.md`
- **Cele 3 planuri detaliate:**
  - [Plan A — Map & Geofence-Maker Experience](./plan-a-map-geofence-experience.md) (973 linii)
  - [Plan B — Baler Workflow & Harvest Status](./plan-b-baler-workflow-harvest-status.md) (1412 linii)
  - [Plan C — Trips, Fleet & Deposit](./plan-c-trips-fleet-deposit.md) (1701 linii)

---

*Document orchestrare generat 2026-05-24. Update după fiecare merge pentru a reflecta state-ul real.*
