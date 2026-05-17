---
name: strawboss-bug-hunt
description: Analiză completă multi-unghi de bug-uri în StrawBoss -- securitate web, securitate mobilă, bug-uri de logică, integritate de date, calitate cod. Folosește înainte de merge, după un feature, sau e rulat automat de workflow-ul GitHub Actions la fiecare push.
---

# StrawBoss Bug Hunt

Analiză statică completă și detaliată de bug-uri pe codul schimbat. Dispecerizează agenți de
review specializați în paralel și consolidează un raport unic, grupat pe severitate.

## Când se folosește

- Pe-demand (`/strawboss-bug-hunt`) înainte de a deschide/merge un PR.
- Automat de `.github/workflows/bug-scan.yml` la fiecare push (vezi CLAUDE.md → Automations).

## Pași

### 1. Determină scope-ul

```bash
git diff --name-only origin/main...HEAD     # PR/branch
# sau, pentru un singur push:
git diff --name-only HEAD~1 HEAD
```

Dacă nu există fișiere schimbate, raportează „nimic de analizat" și oprește-te.
Dacă scope-ul e gol dar e cerut explicit un scan complet, folosește toate fișierele sursă.

### 2. Dispecerizează 4 agenți de review ÎN PARALEL

Trimite un singur mesaj cu 4 apeluri de agent. Fiecare primește lista fișierelor schimbate
relevante ariei lui și diff-ul:

| Agent | Acoperă | Fișiere |
|---|---|---|
| `security-reviewer` | Securitate backend + DB/RLS | `backend/service/src/`, `supabase/migrations/` |
| `web-reviewer` | Bug-uri admin-web (XSS, i18n, React) | `apps/admin-web/` |
| `mobile-reviewer` | Bug-uri mobile (sync, offline, secrete) | `apps/mobile/` |
| `logic-reviewer` | Bug-uri de logică transversale | `packages/`, oriunde |

Dacă o arie nu are fișiere schimbate, sari peste agentul ei.

### 3. Consolidează raportul

Adună findings-urile de la toți agenții. Elimină duplicatele. Sortează pe severitate.
Pentru fiecare finding: `fișier:linie`, categorie, descriere, **de ce e bug**, fix sugerat,
nivel de încredere (high/medium/low).

Categorii urmărite:
- **Securitate web/backend** — multi-tenancy / izolare org, SQL injection, auth bypass,
  validare lipsă (`@Body()` fără Zod), escaladare privilegii, fișiere statice expuse.
- **Securitate mobilă** — secrete în cod, abuz de idempotency sync, scurgeri de date offline,
  stocare nesigură.
- **Securitate frontend** — XSS în popup-uri Leaflet (lipsă `esc()`), HTML nesigur.
- **Logică** — tranziții invalide în XState trip machine, erori de reconciliere bale/fuel,
  race conditions, geofence fără dedup, off-by-one.
- **Integritate date** — coloane generate, filtru `deleted_at IS NULL` lipsă, `sync_version`,
  consistență FK.
- **Calitate cod** — null/undefined netratat, erori înghițite (`catch {}`), cod mort, tipuri nesigure.

### 4. Output

**Mod on-demand**: afișează raportul în conversație.

**Mod CI** (când rulezi în GitHub Actions): creează un GitHub issue cu raportul:

```bash
gh issue create --label bug-scan --title "Bug scan: <short-sha>" --body-file <raport.md>
```

## Format raport

```markdown
# Bug Hunt — <branch / commit>

Fișiere analizate: N. Findings: X critical, Y high, Z medium, W low.

## 🔴 Critical
### [SECURITY-WEB] `backend/service/src/foo.ts:42`
**Bug:** ... **De ce:** ... **Fix:** ... **Încredere:** high

## 🟠 High
...
## 🟡 Medium
...
## 🟢 Low
...

## ✅ Arii verificate fără probleme
- ...
```

## Reguli

- Analiză **statică** — proiectul nu are teste; nu te baza pe rularea de teste.
- Raportează doar findings reale, cu încredere justificată. Nu inventa, nu umfla severitatea.
- Un finding fără `fișier:linie` și fără fix sugerat nu e util — nu-l include.
- Nu modifica cod — acest skill doar analizează și raportează.
