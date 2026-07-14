-- =============================================================================
-- MSDPS · Phase 0 · Migration 0003 — ID generation engine
-- =============================================================================
-- Phase 0 §2.1:
--   * ID auto-generated ONLY after mandatory validation passes (never before).
--   * IDs are system-generated, immutable, and NEVER reused.
--   * Format: PREFIX-YYYYMM-NNNN  (e.g. MER-202607-0001)
--   * Special case (M9 / OTA-7): Creator master = CRT-NNNN (no month bucket).
--
-- Mechanism: a per-(prefix, period) counter row, incremented atomically with an
-- INSERT ... ON CONFLICT DO UPDATE. This is concurrency-safe (single statement,
-- row-locked) and last_seq is monotonic — deleting a draft never frees a number,
-- guaranteeing "never reused".
-- =============================================================================

create table id_sequences (
  prefix    text not null,
  period    char(6) not null,           -- 'YYYYMM', or '000000' for global (CRT)
  last_seq  integer not null default 0,
  primary key (prefix, period)
);

comment on table id_sequences is 'Monotonic per-prefix-per-month counters. Never decremented -> IDs never reused.';

-- Monthly-bucketed code: PREFIX-YYYYMM-NNNN
create or replace function next_code(p_prefix text, p_at timestamptz default now())
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_period char(6) := to_char(p_at, 'YYYYMM');
  v_seq    integer;
begin
  insert into id_sequences (prefix, period, last_seq)
  values (p_prefix, v_period, 1)
  on conflict (prefix, period)
  do update set last_seq = id_sequences.last_seq + 1
  returning last_seq into v_seq;

  return p_prefix || '-' || v_period || '-' || lpad(v_seq::text, 4, '0');
end $$;

comment on function next_code(text, timestamptz) is 'Issue PREFIX-YYYYMM-NNNN. Call only after mandatory validation passes.';

-- Global (non-monthly) code: PREFIX-NNNN  — used for CRT- (Creator master).
create or replace function next_code_global(p_prefix text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_seq integer;
begin
  insert into id_sequences (prefix, period, last_seq)
  values (p_prefix, '000000', 1)
  on conflict (prefix, period)
  do update set last_seq = id_sequences.last_seq + 1
  returning last_seq into v_seq;

  return p_prefix || '-' || lpad(v_seq::text, 4, '0');
end $$;

comment on function next_code_global(text) is 'Issue PREFIX-NNNN (no month). For CRT- creator master (OTA-7).';

-- id_sequences is internal plumbing: enable RLS with no policies so only
-- SECURITY DEFINER functions (which run as owner) can touch it.
alter table id_sequences enable row level security;
