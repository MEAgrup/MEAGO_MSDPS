-- =============================================================================
-- MSDPS · Fase C · Module 10 — Live Stream Vendor-Results Tracker (`LSR-…`)
-- =============================================================================
-- BUKAN modul eksekusi — tracker hasil. Vendor kirim file mentah → tim MEAGO!
-- normalisasi ke Template Baku → AM upload (atau input manual fallback).
-- 1 LSR = 1 minggu hasil per Brief. Attribusi by nama merchant (pencocokan
-- toleran di UI); baris tak cocok = [Unmatched] untuk di-resolve AM.
-- Juga: merchant_gmv_authoritative (GMV manual + confidence tag, Phase 0).
-- =============================================================================

create type lsr_source as enum ('[Upload Template]','[Input Manual]');
create type lsr_status as enum ('[Lengkap]','[Data Tidak Lengkap]','[Unmatched]');

create table live_stream_results (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                    -- LSR-YYYYMM-NNNN
  brief_id          uuid references briefs(id),     -- null selama [Unmatched]
  merchant_name_raw text,                           -- nama dari file (jejak attribusi)
  week_number       int not null,
  gmv               numeric,                        -- Total GMV / Omzet
  jam_tayang        numeric,                        -- jam
  total_view        bigint,
  total_like        bigint,
  total_komen       bigint,
  total_share       bigint,
  entry_source      lsr_source not null default '[Input Manual]',
  source_file_ref   text,                           -- arsip file template (audit); null kalau manual
  entry_status      lsr_status not null default '[Unmatched]',  -- DERIVED di validate
  uploaded_by       uuid default auth.uid() references employees(id),
  uploaded_at       timestamptz not null default now()
);

-- Idempotensi: 1 LSR per minggu per Brief (replace = update baris yang sama).
create unique index lsr_brief_week_uniq on live_stream_results (brief_id, week_number)
  where brief_id is not null;

create or replace function lsr_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief briefs%rowtype;
begin
  if new.week_number is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if not (is_od() or is_director() or auth_division() = 'Account') then
    raise exception '[hanya AM yang dapat mencatat hasil Live Stream]'
      using errcode = 'insufficient_privilege';
  end if;

  if new.brief_id is not null then
    select * into v_brief from briefs where id = new.brief_id;
    if not found then raise exception '[brief tidak ditemukan]'; end if;
    if v_brief.assigned_division <> 'LiveStream' then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    if v_brief.status not in ('[Diteruskan ke Vendor]','[Completed]') then
      raise exception '[Brief belum diteruskan ke vendor]' using errcode = 'check_violation';
    end if;
  end if;

  -- Entry Status derived (M10 Rule 6–7).
  new.entry_status :=
    case
      when new.brief_id is null then '[Unmatched]'::lsr_status
      when new.gmv is null or new.jam_tayang is null or new.total_view is null
        or new.total_like is null or new.total_komen is null or new.total_share is null
        then '[Data Tidak Lengkap]'::lsr_status
      else '[Lengkap]'::lsr_status
    end;

  if new.code is null then new.code := next_code('LSR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_lsr_validate before insert or update on live_stream_results
  for each row execute function lsr_validate();
create trigger trg_lsr_audit after insert or update on live_stream_results
  for each row execute function capture_audit('lsr');

-- Achievement per Brief Live Stream: akumulasi vs Target Metric(s), per metrik
-- independen (M10 §4.4). target_metrics: {"target_gmv": n, "target_jam_tayang": n}
create view v_ls_achievement with (security_invoker = true) as
select
  b.id as brief_id,
  b.code,
  b.service_id,
  b.status,
  coalesce(sum(l.gmv), 0)        as total_gmv,
  coalesce(sum(l.jam_tayang), 0) as total_jam_tayang,
  (b.target_metrics->>'target_gmv')::numeric        as target_gmv,
  (b.target_metrics->>'target_jam_tayang')::numeric as target_jam_tayang,
  count(l.id)                    as weeks_reported
from briefs b
left join live_stream_results l on l.brief_id = b.id
where b.assigned_division = 'LiveStream'
group by b.id;

-- =============================================================================
-- GMV authoritative per merchant per bulan — manual + confidence tag (Phase 0)
-- =============================================================================
create table merchant_gmv_authoritative (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  period      char(6) not null check (period ~ '^[0-9]{6}$'),  -- YYYYMM
  gmv_value   numeric not null,
  confidence  text not null check (confidence in ('[GMV Terverifikasi]','[GMV Estimasi]')),
  source_note text,
  entered_by  uuid default auth.uid() references employees(id),
  entered_at  timestamptz not null default now(),
  unique (merchant_id, period)
);

comment on table merchant_gmv_authoritative is 'GMV bulanan otoritatif per merchant: entry manual + confidence tag (API menyusul). Basis M13 Merchant Health.';

create or replace function gmv_auth_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merchant_id is null or new.period is null or new.gmv_value is null or new.confidence is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if not (is_od() or is_director() or auth_division() = 'Account') then
    raise exception '[hanya Account yang dapat mencatat GMV otoritatif]'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_gmv_auth_validate before insert or update on merchant_gmv_authoritative
  for each row execute function gmv_auth_validate();
create trigger trg_gmv_auth_audit after insert or update on merchant_gmv_authoritative
  for each row execute function capture_audit('merchant_gmv');

-- ---- RLS ----------------------------------------------------------------------
alter table live_stream_results enable row level security;
create policy lsr_select on live_stream_results for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Account','LiveStream'));
create policy lsr_insert on live_stream_results for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Account');
create policy lsr_update on live_stream_results for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');

alter table merchant_gmv_authoritative enable row level security;
create policy gmv_auth_select on merchant_gmv_authoritative for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Account','Finance'));
create policy gmv_auth_manage on merchant_gmv_authoritative for all to authenticated
  using (is_od() or is_director() or auth_division() = 'Account')
  with check (is_od() or is_director() or auth_division() = 'Account');

-- ---- Function grants -----------------------------------------------------------
revoke execute on function lsr_validate()      from public, anon, authenticated;
revoke execute on function gmv_auth_validate() from public, anon, authenticated;
