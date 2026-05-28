# Accounts Page — depot_manager Visibility Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Utilizatorii cu rolul `depot_manager` să apară în tabelul de pe pagina Accounts din admin-web.

**Architecture:** `GROUP_ORDER` (array static în `accounts/page.tsx`) dictează ce grupuri de roluri se randează în tabel. `depot_manager` există în `ALL_ROLES`, are culori, iconițe și traduceri definite, dar lipsește din `GROUP_ORDER` — deci userii cu acel rol sunt omisi la render.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, `@strawboss/types` (UserRole enum)

---

## File Map

| Fișier | Modificare |
|--------|-----------|
| `apps/admin-web/src/app/[slug]/(dashboard)/accounts/page.tsx` | Adaugă `UserRole.depot_manager` în `GROUP_ORDER` (linia 50) |

---

### Task 1: Adaugă depot_manager în GROUP_ORDER

**Files:**
- Modify: `apps/admin-web/src/app/[slug]/(dashboard)/accounts/page.tsx:50-56`

- [ ] **Step 1: Deschide fișierul și localizează GROUP_ORDER**

```
apps/admin-web/src/app/[slug]/(dashboard)/accounts/page.tsx
liniile 50-56
```

- [ ] **Step 2: Adaugă UserRole.depot_manager în GROUP_ORDER**

Înlocuiește blocul existent:

```typescript
const GROUP_ORDER: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
  UserRole.geofence_maker,
];
```

Cu:

```typescript
const GROUP_ORDER: UserRole[] = [
  UserRole.admin,
  UserRole.baler_operator,
  UserRole.loader_operator,
  UserRole.driver,
  UserRole.geofence_maker,
  UserRole.depot_manager,
];
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @strawboss/admin-web typecheck
```

Așteptat: zero erori.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/app/\[slug\]/\(dashboard\)/accounts/page.tsx
git commit -m "fix(admin-web): show depot_manager accounts in Accounts page"
```

---

## Verificare manuală

1. Porni dev: `./strawboss.sh dev`
2. Navighează la `http://localhost:3000/<slug>/accounts`
3. Dacă nu există niciun user cu rol `depot_manager`, creează unul din „+ Cont nou" → selectează „Operator depozit"
4. Verifică că apare în tabelul principal grupat sub secțiunea „Operator depozit"
5. Verifică că badge-ul rolului are culoarea portocalie (`bg-orange-100 text-orange-700`)
6. Verifică că apare corect și la filtrare după status (activ/inactiv) și search
