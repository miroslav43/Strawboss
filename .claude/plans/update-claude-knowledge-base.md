# Plan: Actualizare `.claude/` knowledge base la zi

## Context

Task-ul anterior (loader multi-parcelă + CMR două etape) este **complet implementat și committed**. Acum task-ul este să aducem la zi toate fișierele din `/srv/apps/Strawboss/.claude/` (docs, agents, skills, issues) să reflecte starea curentă a codului.

## Ce s-a schimbat față de documentația existentă

### Entități / tipuri noi
- `UserRole`: adăugat `geofence_maker` (era 5 valori, acum 6)
- `DocumentStatus`: adăugat `partial` între `generating` și `generated`
- `Trip`: adăugate câmpuri `loaderSignatureUrl`, `driverSignatureUrl`, `deterioratedBalesCount`
- `Farm`: adăugate `phone`, `fiscalCode`, `registrationNumber`, `bankAccount`, `bankName`
- `Machine`: adăugate `companyName`, `companyAddress`
- `Parcel`: eliminat câmpul direct `owner`

### Backend
- **CMR generator** (cmr.service.ts + cmr.processor.ts): acum two-stage — `stage: 1` la departure (partial PDF), `stage: 2` la complete (final PDF)
- **Auth guard** (auth.guard.ts): adăugat fallback `hydrateOrganizationFromJwt()` — când JWT hook omite org claims, le încarcă din DB
- **trips.service.ts**: `registerLoad()` salvează `loaderSignature`, `depart()` salvează `driverSignature` + queues stage 1 CMR, `complete()` queues stage 2 CMR
- **task-assignments.service.ts**: fix-uri ownership check

### Mobile
- **`/(geofence-maker)/`**: rol nou, 5 ecrane (index, farms, map, profile, _layout)
- **`driver-ops/departure-flow.tsx`**: nou ecran two-step (odometru + semnătură șofer) înlocuiește apelul direct depart
- **`useCurrentLoaderParcel`**: GPS timeout 15s (era 5s), retry automat 1x după 5s, status nou `multiple_active`
- **`useMyTasks`**: refetchInterval 30s (era 60s)
- **`load-bales.tsx`**: snapshot `parcelId` la mount

### Nginx
- Refactorizat din `nginx.conf` monolitic → `conf.d/` cu fișiere per virtual host (10-nortiauno.com.conf, 20-video.tedde-auto.ro.conf, etc.)

### Migrații DB
- Docs spun 00001–00024, acum există 00001–00037

### Security issues rezolvate
- H-15, H-16, M-1 marcate ca fixed în commits recente

---

## Plan de execuție

### 1. `docs/architecture.md`
- Roluri: adaugă `geofence_maker` (acum 6 roluri)
- Auth: notă despre JWT org claim hydration fallback din DB
- CMR / BullMQ: two-stage (stage 1 la departure, stage 2 la complete)
- DocumentStatus: menționează `partial`

### 2. `docs/database.md`
- `user_role` enum: adaugă `geofence_maker`
- `document_status` enum: adaugă `partial` (între generating și generated)
- Tabelul `trips`: adaugă `loader_signature_url`, `driver_signature_url`, `deteriorated_bales_count`
- Tabelul `farms`: adaugă `phone`, `fiscal_code`, `registration_number`, `bank_account`, `bank_name`
- Tabelul `machines`: adaugă `company_name`, `company_address`
- Tabelul `parcels`: elimină câmpul `owner`
- Migrații: actualizează referința la 00001–00037

### 3. `docs/backend.md`
- CMR: documentează two-stage (`stage: 1 | 2`, partial → generated)
- Auth guard: notă despre `hydrateOrganizationFromJwt()` DB fallback
- trips.service: documentează noile câmpuri salvate la transitions

### 4. `docs/mobile.md`

- Adaugă `geofence_maker` în tabelul de role routing
- Adaugă `driver-ops/departure-flow.tsx` în feature flows
- `useCurrentLoaderParcel`: GPS timeout 15s + retry + status `multiple_active`
- `useMyTasks`: refetchInterval 30s

### 5. `docs/packages-types.md`
- `UserRole`: adaugă `geofence_maker`
- `DocumentStatus`: adaugă `partial`
- `Trip` entity: adaugă 3 câmpuri noi
- `Farm` entity: adaugă 5 câmpuri noi
- `Machine` entity: adaugă 2 câmpuri noi
- `Parcel` entity: elimină `owner`

### 6. `docs/packages-validation.md`
- `registerLoadSchema`: adaugă `loaderSignature` optional
- `departSchema`: adaugă `driverSignature` required
- `confirmDeliverySchema`: adaugă `weightTicketPhotoUrl` optional, `deterioratedBalesCount` optional

### 7. `docs/infrastructure.md`
- nginx: actualizează descripția — acum `conf.d/` split, nu mai există `nginx.conf` monolitic
- Notă despre `nginx.conf.legacy` ca backup

### 8. `agents/mobile-agent.md`
- Adaugă `geofence_maker` la ROLE_ROUTES
- Documentează status `multiple_active` pentru `useCurrentLoaderParcel`
- Menționează `driver-ops/departure-flow` pattern (odometru + semnătură)

### 9. `agents/backend-agent.md`
- Auth guard: notă despre DB hydration fallback
- CMR: notă despre stage param în job payload

### 10. `agents/devops-agent.md`
- nginx conf.d pattern — fișiere per virtual host, nu monolitic

### 11. `agents/db-agent.md`
- Actualizează numărul de migrații (00037)
- Actualizează enums (geofence_maker, partial)

### 12. `skills/strawboss-review.md`
- Adaugă `geofence_maker` la rolurile valide
- Adaugă check: CMR two-stage (stage 1 la depart, stage 2 la complete)

### 13. `issues/security-audit-2026-05-11.md`
- Marchează **H-15**, **H-16**, **M-1** ca `✅ FIXED` (commiturile `2ff6194` și `9d59495`)

---

## Fișiere de modificat

| Fișier | Modificări |
|--------|-----------|
| `docs/architecture.md` | geofence_maker role, CMR two-stage, JWT hydration, partial status |
| `docs/database.md` | enums, trip/farm/machine/parcel fields, migration count |
| `docs/backend.md` | CMR two-stage, auth guard hydration, trips.service transitions |
| `docs/mobile.md` | geofence_maker routing, departure-flow, useCurrentLoaderParcel updates |
| `docs/packages-types.md` | UserRole, DocumentStatus, Trip/Farm/Machine/Parcel entity fields |
| `docs/packages-validation.md` | DTO schemas pentru departure + load + delivery |
| `docs/infrastructure.md` | nginx conf.d split |
| `agents/mobile-agent.md` | geofence_maker, multiple_active, departure-flow |
| `agents/backend-agent.md` | auth hydration, CMR stage |
| `agents/devops-agent.md` | nginx conf.d |
| `agents/db-agent.md` | migration count, enum updates |
| `skills/strawboss-review.md` | geofence_maker role, CMR two-stage check |
| `issues/security-audit-2026-05-11.md` | marchează H-15, H-16, M-1 ca fixed |

Fișiere **neschimbate**: `docs/packages-domain.md`, `docs/packages-api.md`, `docs/packages-ui-tokens.md`, `docs/sync-protocol.md`, `docs/scripts.md`, `agents/frontend-agent.md`, `skills/strawboss-feature.md`, `skills/strawboss-deploy.md`, `skills/strawboss-debug.md`, `settings.json`, `settings.local.json`

---

## Verificare

După aplicarea modificărilor — citește fiecare fișier modificat și verifică că:
1. Nu există referințe la valori vechi (5 roluri, timeout 5s, migration 00024, nginx.conf monolitic)
2. H-15, H-16, M-1 sunt marcate clar cu ✅ FIXED și numărul de commit în issues
3. CMR two-stage e descris consistent în docs/backend, agents/backend și skills/review
