---
name: strawboss-sync-docs
description: Sincronizează knowledge base-ul .claude/ (docs, agents, skills, issues) cu starea curentă a codului StrawBoss. Folosește după finalizarea unui feature, înainte de a deschide un PR, sau când documentația pare învechită.
---

# StrawBoss Sync Docs

Aduce la zi toate fișierele din `.claude/` ca să reflecte codul curent. Documentația
nu se actualizează singură când se schimbă codul — acest skill închide acel gap.

## Când se folosește

- După ce un feature branch e gata (înainte de PR sau merge).
- Când observi că un doc descrie cod care nu mai există.
- Rulat automat săptămânal de rutina programată (vezi CLAUDE.md → Claude Code Automations).

## Pași

### 1. Determină ce s-a schimbat

```bash
git -C /srv/apps/Strawboss diff main...HEAD --name-only
git -C /srv/apps/Strawboss log main...HEAD --oneline
```

Dacă ești pe `main`, folosește în schimb ultimele commituri relevante:
`git log --oneline -20` și `git diff HEAD~N --name-only`.

### 2. Mapează fișierele schimbate la docs

| Cod schimbat | Fișiere `.claude/` de actualizat |
|---|---|
| `supabase/migrations/` | `docs/database.md`, `agents/db-agent.md` |
| `packages/types/src/` | `docs/packages-types.md` |
| `packages/validation/src/` | `docs/packages-validation.md` |
| `packages/domain/src/` | `docs/packages-domain.md` |
| `packages/api/src/` | `docs/packages-api.md` |
| `packages/ui-tokens/src/` | `docs/packages-ui-tokens.md` |
| `backend/service/src/` | `docs/backend.md`, `agents/backend-agent.md` |
| `backend/service/src/sync/` | `docs/sync-protocol.md` |
| `apps/mobile/` | `docs/mobile.md`, `agents/mobile-agent.md` |
| `apps/admin-web/` | `docs/admin-web.md`, `agents/frontend-agent.md` |
| `nginx/`, `docker-compose.yml`, `Dockerfile.*` | `docs/infrastructure.md`, `agents/devops-agent.md` |
| `scripts/`, `strawboss.sh` | `docs/scripts.md` |
| arhitectură generală (module noi, fluxuri) | `docs/architecture.md` |

### 3. Actualizează docs-urile

Pentru fiecare doc afectat:
- **Citește fișierul real din cod** (migrația SQL, entitatea TypeScript, schema Zod) — NU
  presupune valorile, extrage-le din sursă.
- Actualizează doar ce s-a schimbat. Nu rescrie fișierul, nu șterge informație validă.
- Verifică valori numerice care se învechesc: numărul de migrații, numărul de roluri,
  timeout-uri, count de module, valori de enum.

### 4. Marchează security issues rezolvate

Dacă un commit message conține `fix(security)`, sau referințe la `H-NN` / `M-NN` / `CR-N`:
- Deschide `issues/security-audit-*.md`.
- Marchează issue-ul corespunzător cu `✅ FIXED` + hash-ul de commit.
- Actualizează tabelul de summary și secțiunea „Already Fixed".

### 5. Raportează

Afișează un tabel: fișier `.claude/` → ce s-a modificat. Listează explicit fișierele
verificate care NU au necesitat modificări.

## Reguli

- Modifică **doar** fișiere din `/srv/apps/Strawboss/.claude/`.
- Nu inventa valori — dacă nu găsești ceva în cod, nu îl scrie în docs.
- Pentru PR-uri mari (5+ docs afectate), dispecerizează agentul `docs-updater` în paralel.
- Migrațiile cu număr duplicat sunt un bug — raportează-le, nu le ascunde.
