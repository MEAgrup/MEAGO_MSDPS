# MSDPS — Merchant Service Delivery & Performance System

Internal system for MEAGO! (PT MEA Agensi Digital). Backend: Supabase (Postgres +
Auth + RLS + Storage). Frontend (later): Next.js App Router on Vercel.

Fase 1 = internal team only (AM, division staff, SPV/Lead, OD, Director).
Merchant Portal = Fase 2 (not built yet).

## Repository layout
```
supabase/
  config.toml            # Supabase CLI config
  migrations/            # numbered SQL migrations (Phase 0 + per module)
  seed/                  # example seed data (holidays, etc.)
lib/                     # (later) Supabase clients + server actions
docs/BUILD_PLAN.md       # progress tracker (module-by-module)
```

## Applying the database
Prereq: Supabase CLI (`brew install supabase/tap/supabase`) and a Supabase project,
or local stack via Docker.

```bash
# Local dev stack:
supabase start
supabase db reset          # applies all migrations in order, then seed

# Or push migrations to a linked remote project:
supabase link --project-ref <ref>
supabase db push
```

Enable `pg_cron` from the Supabase Dashboard (Database > Extensions) before the
Module 13/14 scheduled-snapshot migrations.

## Enforcement model (why the DB does the heavy lifting)
Supabase exposes every table over PostgREST, so business rules live in Postgres
where they cannot be bypassed:
- **IDs** (`PREFIX-YYYYMM-NNNN`) — issued by trigger only after validation; immutable; never reused.
- **State machines** — `BEFORE UPDATE` trigger + `status_transitions` table block illegal/unauthorized jumps.
- **Derived fields** — generated columns / triggers / views / pg_cron; never writable from UI/API.
- **Audit log** — append-only; UPDATE/DELETE blocked for everyone (incl. Director & service_role).
- **Access** — RLS per table from the Phase 0 §4 role matrix.

See `MSDPS_STEP1_Architecture_Blueprint.md` for the full design.
