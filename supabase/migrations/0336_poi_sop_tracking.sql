-- =============================================================================
-- MSDPS · BizDev · Migration 0336 — POI Accommodation & TTD: SOP visit tracker
-- =============================================================================
-- Tab baru "BizDev Workspace" (app/(app)/bizdev/poi) menampilkan transaksi
-- brand_deals berkategori POI Accommodation ('Accomodation') & TTD, masing-
-- masing dengan tracker SOP 15-step (Step → Task → SLA sesuai SOP tim Ops) plus
-- tiga metrik SLA turunan (Total / Pre-Visit / Post-Visit).
--
-- poi_sop_progress (1:1 brand_deals via deal_id) : field tambahan yang belum ada
--   di brand_deals — Tanggal Ops (override; null = pakai saran H-10 dari
--   visit_start_date), Actual VT, Total GMV, Link & Status Report Monthly.
-- poi_sop_steps (1:N progress) : status selesai per step (1..15), sekali
--   selesai tidak bisa diubah lagi, wajib berurutan (step N butuh step N-1
--   selesai). Baris di-auto-create (15 sekaligus) begitu brand_deals.kategori_poi
--   berisi 'Accomodation'/'TTD' — trigger insert/update on brand_deals +
--   backfill baris existing di bawah.
-- =============================================================================

create table poi_sop_progress (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null unique references brand_deals(id) on delete cascade,
  ops_datetime   timestamptz,                 -- null = pakai saran H-10 dari visit_start_date
  actual_vt      numeric check (actual_vt is null or actual_vt >= 0),
  total_gmv      numeric check (total_gmv is null or total_gmv >= 0),
  report_link    text,
  report_status  text check (report_status is null or report_status in
                    ('Approved','Waiting Confirmation','Request','Revisi')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz
);

create table poi_sop_steps (
  id            uuid primary key default gen_random_uuid(),
  progress_id   uuid not null references poi_sop_progress(id) on delete cascade,
  step_no       int not null check (step_no between 1 and 15),
  completed_at  timestamptz,
  completed_by  uuid references employees(id),
  unique (progress_id, step_no)
);

create index poi_sop_steps_progress_idx on poi_sop_steps (progress_id);

-- ---- Auto-provision progress + 15 step rows ---------------------------------
create or replace function poi_sop_ensure_progress(p_deal_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into poi_sop_progress (deal_id) values (p_deal_id)
  on conflict (deal_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into poi_sop_steps (progress_id, step_no)
    select v_id, s from generate_series(1, 15) s;
  else
    select id into v_id from poi_sop_progress where deal_id = p_deal_id;
  end if;

  return v_id;
end $$;

create or replace function brand_deals_poi_sop_ensure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kategori_poi in ('Accomodation','TTD') then
    perform poi_sop_ensure_progress(new.id);
  end if;
  return null;
end $$;

create trigger trg_brand_deals_poi_sop_ensure after insert or update of kategori_poi on brand_deals
  for each row execute function brand_deals_poi_sop_ensure();

-- Backfill: baris brand_deals POI Accommodation/TTD yang sudah ada sebelum migrasi ini.
do $$
declare r record;
begin
  for r in select id from brand_deals where kategori_poi in ('Accomodation','TTD') loop
    perform poi_sop_ensure_progress(r.id);
  end loop;
end $$;

-- ---- poi_sop_steps: selesai sekali jalan, wajib berurutan -------------------
create or replace function poi_sop_steps_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev_done boolean;
begin
  if old.completed_at is not null then
    raise exception '[step sudah selesai, tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  if new.completed_at is not null then
    if new.step_no > 1 then
      select (completed_at is not null) into v_prev_done
      from poi_sop_steps
      where progress_id = new.progress_id and step_no = new.step_no - 1;
      if not coalesce(v_prev_done, false) then
        raise exception '[selesaikan step sebelumnya terlebih dahulu]' using errcode = 'check_violation';
      end if;
    end if;
    new.completed_by := auth.uid();
  end if;
  return new;
end $$;

create trigger trg_poi_sop_steps_validate before update on poi_sop_steps
  for each row execute function poi_sop_steps_validate();

-- ---- poi_sop_progress: jejak siapa & kapan terakhir diubah ------------------
create or replace function poi_sop_progress_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger trg_poi_sop_progress_touch before update on poi_sop_progress
  for each row execute function poi_sop_progress_touch();

create trigger trg_poi_sop_progress_audit after insert or update on poi_sop_progress
  for each row execute function capture_audit('poi_sop_progress');
create trigger trg_poi_sop_steps_audit after insert or update on poi_sop_steps
  for each row execute function capture_audit('poi_sop_step');

-- ---- RLS: sama dengan gate BizDev Workspace (mgmt + divisi BizDev) ----------
alter table poi_sop_progress enable row level security;
create policy poi_sop_progress_select on poi_sop_progress for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');
create policy poi_sop_progress_update on poi_sop_progress for update to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev')
  with check (is_od() or is_director() or auth_division() = 'BizDev');

alter table poi_sop_steps enable row level security;
create policy poi_sop_steps_select on poi_sop_steps for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');
create policy poi_sop_steps_update on poi_sop_steps for update to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev')
  with check (is_od() or is_director() or auth_division() = 'BizDev');

revoke execute on function poi_sop_ensure_progress(uuid) from public, anon, authenticated;
revoke execute on function brand_deals_poi_sop_ensure()   from public, anon, authenticated;
revoke execute on function poi_sop_steps_validate()       from public, anon, authenticated;
revoke execute on function poi_sop_progress_touch()       from public, anon, authenticated;
