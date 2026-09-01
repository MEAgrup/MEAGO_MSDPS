-- =============================================================================
-- MSDPS · Leads/BD · Migration 0338 — Riwayat transisi status CRM (lead_status_history)
-- =============================================================================
-- "Dashboard CRM" (tab baru di bawah Leads & Prospek) butuh rata-rata durasi
-- antar tahap pipeline (Avg Lead → Approach, Avg Approach → Deals) dan
-- timeseries "Total Approaching per hari". `leads.crm_status_changed_at`
-- (migrasi 0331) hanya menyimpan WAKTU PERUBAHAN TERAKHIR — tidak cukup untuk
-- menghitung durasi antar tahap begitu sebuah lead sudah pindah status lebih
-- dari sekali. Migrasi ini menambah tabel log append-only yang mencatat SETIAP
-- transisi crm_status, diisi otomatis lewat trigger AFTER (leads_validate di
-- 0330/0331 tetap trigger BEFORE yang menormalkan data — trigger baru ini
-- hanya membaca hasil akhirnya).
--
-- Data historis (baris leads yang sudah ada sebelum migrasi ini) di-backfill
-- dengan pendekatan: satu entri masuk 'Leads' (created_at) + satu entri
-- transisi 'Leads' -> status saat ini (crm_status_changed_at, atau created_at
-- kalau belum pernah berubah). Ini APROKSIMASI — status antara yang sudah
-- dilewati sebelum migrasi (mis. Approaching -> Follow Up -> Dealing) tidak
-- tercatat karena memang tidak pernah disimpan. Data baru sejak migrasi ini
-- tercatat lengkap per transisi.
--
-- Idempotent, supaya aman dijalankan ulang oleh scripts/apply_migrations.mjs.
-- =============================================================================

create table if not exists lead_status_history (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

comment on table lead_status_history is
  'Log append-only setiap transisi leads.crm_status — dasar perhitungan Avg Lead→Approach / Avg Approach→Deals dan timeseries approaching di Dashboard CRM.';
comment on column lead_status_history.from_status is 'NULL untuk entri pertama (lead baru dibuat, selalu masuk sebagai ''Leads'').';

create index if not exists lead_status_history_lead_idx on lead_status_history (lead_id);
create index if not exists lead_status_history_to_status_idx on lead_status_history (to_status, changed_at);

alter table lead_status_history enable row level security;
do $$ begin
  create policy lead_status_history_select on lead_status_history for select to authenticated
    using (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));
exception when duplicate_object then null;
end $$;

-- ---- Trigger: catat setiap transisi (AFTER, membaca hasil akhir leads_validate) ----
create or replace function leads_status_history_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_status_history (lead_id, from_status, to_status, changed_by, changed_at)
    values (new.id, null, new.crm_status, new.crm_status_changed_by, coalesce(new.crm_status_changed_at, new.created_at));
  elsif tg_op = 'UPDATE' and new.crm_status is distinct from old.crm_status then
    insert into lead_status_history (lead_id, from_status, to_status, changed_by, changed_at)
    values (new.id, old.crm_status, new.crm_status, new.crm_status_changed_by, coalesce(new.crm_status_changed_at, now()));
  end if;
  return null;
end $$;

revoke execute on function leads_status_history_log() from public, anon, authenticated;

drop trigger if exists leads_status_history_trg on leads;
create trigger leads_status_history_trg
  after insert or update on leads
  for each row execute function leads_status_history_log();

-- ---- Backfill data lama (aproksimasi, lihat catatan di atas) ----
insert into lead_status_history (lead_id, from_status, to_status, changed_by, changed_at)
select l.id, null, 'Leads', null, l.created_at
from leads l
where not exists (
  select 1 from lead_status_history h
  where h.lead_id = l.id and h.from_status is null and h.to_status = 'Leads'
);

insert into lead_status_history (lead_id, from_status, to_status, changed_by, changed_at)
select l.id, 'Leads', l.crm_status, l.crm_status_changed_by, coalesce(l.crm_status_changed_at, l.created_at)
from leads l
where l.crm_status <> 'Leads'
  and not exists (
    select 1 from lead_status_history h
    where h.lead_id = l.id and h.from_status = 'Leads' and h.to_status = l.crm_status
  );
