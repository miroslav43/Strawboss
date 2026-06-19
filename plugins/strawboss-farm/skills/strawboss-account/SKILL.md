---
name: strawboss-account
description: Dezvoltă sau modifică un feature pentru un anumit tip de account (rol) StrawBoss. Rutează către agentul specialist per-rol potrivit și aplică checklist-ul cross-strat al rolului (mobil/web + @Roles + RLS + state machine). Folosește când ceri „feature pentru driver/loader/baler/geofence_maker/depot_manager/dispatcher/admin/super_admin".
---

# StrawBoss — dezvoltare pe tip de account (rol)

Orchestrezi dezvoltarea unui feature **centrat pe un rol**, alegând specialistul potrivit și aplicând convențiile feliei lui.

## 1. Identifică rolul

Cele 8 roluri și agentul lor specialist:

| Rol | Agent | Felie principală |
|---|---|---|
| driver | `role-driver` | mobil `(driver)`, trips/livrare, fuel, GPS |
| loader_operator | `role-loader-operator` | mobil `(loader)`, bale-loads, consumabile |
| baler_operator | `role-baler-operator` | mobil `(baler)`, bale-productions |
| geofence_maker | `role-geofence-maker` | mobil `(geofence-maker)`, farms/parcels, PostGIS |
| depot_manager | `role-depot-manager` | mobil `(deposit)`, deposit-inventory |
| dispatcher | `role-dispatcher` | admin-web command-center/tasks/trips/map |
| admin | `role-admin` | admin-web complet, admin-users |
| super_admin | `role-super-admin` | admin-web super-admin, organizations |

Dacă rolul nu e clar din cerere, întreabă scurt care rol (sau ce ecran/pagină).

## 2. Dispecerizează

1. Lansează agentul `role-*` corespunzător pentru contextul de rol (felie, RLS, tranziții).
2. Pentru implementarea pe straturi, agentul de rol orchestrează agenții existenți: `mobile-agent`, `frontend-agent`, `backend-agent`, `db-agent`, `devops-agent`.
3. Dacă feature-ul atinge mai multe roluri, rulează agenții de rol relevanți **în paralel** (un singur mesaj, mai multe apeluri).

## 3. Checklist cross-strat (pe rol)

- [ ] Migrație idempotentă + **RLS pentru rol** (cast `::text` pe rol în policy noi).
- [ ] `@Roles(...)` pe toate scrierile backend; `ZodValidationPipe` pe `@Body()`.
- [ ] Mobil: ecranul în grupul de rute corect (`ROLE_ROUTES`); scrieri prin **sync queue** cu `idempotencyKey` UUID; repo înregistrat în `SyncManager`.
- [ ] Web: string-uri prin `t()` în `en.json` ȘI `ro.json`; `esc()` în Leaflet; hooks + `queryKeys`.
- [ ] Tranzițiile de trip via `getAvailableTransitions()` (nu modifica direct statusul).
- [ ] Org-scoping pe orice query (`WHERE deleted_at IS NULL`, `LIMIT` pe liste).
- [ ] Typecheck după modificări (`./strawboss.sh typecheck <target>`).

## 4. Finalizare

Folosește `strawboss-feature` pentru pașii standard pe straturi și `strawboss-review` pentru checklist-ul de review. După un feature care atinge schema/types/migrații, rulează `strawboss-docs-sync` (sau `strawboss-sync-docs`).
