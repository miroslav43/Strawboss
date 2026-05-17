---
name: strawboss-new-migration
description: Creează o migrație PostgreSQL nouă pentru StrawBoss — idempotentă, cu RLS, indexes parțiale și sync_version. Folosește când trebuie adăugat/modificat un tabel, coloană, enum sau policy în schema bazei de date.
---

# StrawBoss New Migration

Ghidează crearea unei migrații SQL noi care respectă toate convențiile proiectului.

## Pași

### 1. Determină următorul număr și verifică conflicte

```bash
ls /srv/apps/Strawboss/supabase/migrations/ | sort
```

- Următoarea migrație = `000NN_<nume_descriptiv>.sql`, NN = ultimul număr + 1.
- **Verifică numere duplicate**: dacă două fișiere au același prefix `000NN_`, semnalează
  imediat — e un bug care strică ordinea de aplicare. (Ex. cunoscut: `00037` apare de 2 ori.)
- Nume: lowercase, underscore, descriptiv (`00039_add_parcel_notes.sql`).

### 2. Scrie migrația idempotentă

Fiecare migrație trebuie să fie sigură la re-rulare:

```sql
-- Coloană nouă
DO $$ BEGIN
  ALTER TABLE parcels ADD COLUMN notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Constraint
DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_foo CHECK (...);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index
CREATE INDEX IF NOT EXISTS idx_foo ON foo (col) WHERE deleted_at IS NULL;

-- Policy
DROP POLICY IF EXISTS pol_foo ON foo;
CREATE POLICY pol_foo ON foo ...;

-- Funcție
CREATE OR REPLACE FUNCTION ...;

-- Valoare de enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'noua_valoare';
```

### 3. Pentru tabele noi

- `ALTER TABLE <tabel> ENABLE ROW LEVEL SECURITY;`
- Policy admin: `FOR ALL USING (public.user_role() = 'admin') WITH CHECK (...)`
- Policy-uri per rol (loader_operator, driver, baler_operator, geofence_maker) după caz.
- Coloane standard: `id UUID DEFAULT gen_random_uuid()`, `created_at`/`updated_at` TIMESTAMPTZ,
  `deleted_at TIMESTAMPTZ` dacă e soft-delete.
- Trigger `set_updated_at()` (vezi `00007_triggers.sql`).
- Indexe parțiale `WHERE deleted_at IS NULL`.

### 4. Dacă tabelul participă la sync mobil

- Coloană `sync_version BIGINT DEFAULT 1`.
- Trigger de incrementare pe UPDATE (pattern în `00007_triggers.sql`).
- Adaugă tabelul în `SYNCABLE_TABLES` și `ALLOWED_COLUMNS` din
  `backend/service/src/sync/sync.service.ts`.

### 5. Aplică și verifică

```bash
./strawboss.sh db:migrate
```

### 6. Sincronizează documentația

Rulează skill-ul `strawboss-sync-docs` (sau actualizează manual `docs/database.md` și
`agents/db-agent.md`): noul tabel/coloane, valori de enum, numărul curent de migrații.

## Reguli

- Toate migrațiile idempotente — sigure la re-rulare.
- RLS obligatoriu pe tabele noi.
- Indexe parțiale pe tabele cu soft delete.
- UUID PK, TIMESTAMPTZ pentru date, JSONB pentru date flexibile.
- Nu reutiliza un număr de migrație deja existent.
