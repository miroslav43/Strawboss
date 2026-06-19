---
name: strawboss-docs-sync
description: Actualizează knowledge base-ul .claude/docs cu mai mulți agenți docs-updater în PARALEL, câte unul pe zonă (backend/db/mobile/web/packages/cross-cutting), apoi consolidează log-ul și indexul. Folosește după un feature mare sau un diff care atinge multe straturi. Varianta paralelă a strawboss-sync-docs.
---

# StrawBoss — sincronizare docs cu agenți în paralel

Varianta de mare debit a lui `strawboss-sync-docs`: în loc să actualizezi doc-urile secvențial, faci **fan-out de agenți `docs-updater` în paralel** pe zone de docs. Folosește modelul din `strawboss-bug-hunt` (un singur mesaj, N apeluri de agent).

## 1. Determină diff-ul

```bash
git diff HEAD~1 --name-only        # sau față de baza PR-ului / un range dat de user
```
Grupează fișierele schimbate pe zone. Sari peste zonele fără modificări.

## 2. Fan-out paralel (un singur mesaj, mai multe apeluri de agent)

Pentru fiecare zonă cu schimbări, lansează un agent **`docs-updater`** căruia îi dai: lista fișierelor schimbate din aria lui + doc-ul/doc-urile țintă. Cere-i să actualizeze DOAR secțiunile afectate și să returneze ce a schimbat (pentru log).

| Agent paralel | Fișiere sursă | Docs țintă |
|---|---|---|
| backend | `backend/service/src/**` | `.claude/docs/backend.md` |
| database | `supabase/migrations/**`, `packages/types` enums | `.claude/docs/database.md` |
| mobile | `apps/mobile/**` | `.claude/docs/mobile.md` |
| admin-web | `apps/admin-web/**` | `.claude/docs/admin-web.md` |
| packages | `packages/**` | `.claude/docs/packages-*.md` |
| cross-cutting | restul (scripts/, nginx/, docker, compose) | `architecture.md`, `sync-protocol.md`, `infrastructure.md`, `scripts.md` |

Fiecare agent: extrage valori **verbatim** din sursă (nu inventa), bump `updated:` în frontmatter-ul doc-ului lui, păstrează `[[wikilinks]]` și convențiile vault-ului.

## 3. Consolidare (în firul principal, după ce revin toți agenții)

- Append în `.claude/docs/log.md`: câte o linie `[YYYY-MM-DD] save | <doc>.md — <descriere>` per doc atins.
- Actualizează `.claude/docs/_index.md` dacă s-au adăugat doc-uri noi.
- Actualizează `.claude/docs/hot.md` DOAR dacă schimbarea e load-bearing (invariante, ce se schimbă acum, locuri cu fricțiune mare).
- Marchează fix-urile de securitate cu `✅ FIXED` + hash de commit în `.claude/issues/` (ca `strawboss-sync-docs`).

## Note

- Reutilizează agentul existent `.claude/agents/docs-updater.md` (registru comun) — nu îl dubla.
- Complementar lui `strawboss-sync-docs` (secvențial, pentru diff-uri mici); aici câștigi pe diff-uri mari care ating 3+ zone.
- Nu rescrie doc-uri întregi; doar secțiunile afectate.
