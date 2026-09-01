-- =============================================================================
-- MSDPS · BizDev · Migration 0337 — POI Dining: SOP tracker (Berbayar siklus
-- bulanan + Free/Barter alur linear)
-- =============================================================================
-- Tab baru "BizDev Workspace" (app/(app)/bizdev/poi-dining) menampilkan
-- transaksi brand_deals berkategori Dining, dengan DUA alur SOP berbeda sesuai
-- bentuk_kerjasama:
--
-- 'Free/Barter' (17 step, berurutan) — flow SAMA PERSIS dengan tab POI
--   Accommodation & TTD (migrasi 0336): dipakai ulang tabel poi_sop_progress/
--   poi_sop_steps yang sudah ada, hanya jumlah step diperluas dari 15 ke 17
--   (constraint step_no & fungsi ensure_progress digeneralisasi menerima
--   total_steps).
--
-- 'Berbayar' (22 step per SIKLUS BULANAN) — mekanisme baru (poi_dining_cycles/
--   poi_dining_steps):
--   - Step 1-5 (MOU/Invoice/Payment): OPSIONAL & TIDAK berurutan (boleh pilih
--     mana saja, urutan bebas), dan boleh DI-SKIP tapi wajib approval Director
--     (skipped_by hanya bisa diisi is_director() — pola sama dengan
--     creator_requests.approved_by di migrasi 0306).
--   - Step 6-22: berurutan seperti biasa, baru bisa dimulai setelah SELURUH
--     step 1-5 selesai/di-skip (bukan cuma step 5).
--   - Satu siklus = satu bulan durasi kontrak (tanggal_mulai_kontrak..
--     tanggal_akhir_kontrak pada brand_deals, mis. 5 Sep-5 Des = 3 siklus).
--     Jumlah siklus dihitung otomatis via trigger insert/update brand_deals &
--     di-backfill di bawah. Provisioning forward-only: menambah siklus yang
--     belum ada, tidak pernah menghapus/mengubah siklus yang sudah berjalan
--     (aman terhadap re-run & tanggal kontrak yang diperpanjang belakangan).
--   - poi_dining_cycles.ops_datetime hanya boleh diisi setelah step 6 siklus
--     tsb selesai (spesifikasi: "Tanggal Ops muncul ketika selesai step 6").
-- =============================================================================

-- ---- 1) Generalisasi poi_sop_progress/poi_sop_steps: 15 -> 17 step (Dining Free/Barter) ----
alter table poi_sop_steps drop constraint poi_sop_steps_step_no_check;
alter table poi_sop_steps add constraint poi_sop_steps_step_no_check check (step_no between 1 and 17);

drop function if exists poi_sop_ensure_progress(uuid);

create function poi_sop_ensure_progress(p_deal_id uuid, p_total_steps int default 15)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into poi_sop_progress (deal_id) values (p_deal_id)
  on conflict (deal_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into poi_sop_steps (progress_id, step_no)
    select v_id, s from generate_series(1, p_total_steps) s;
  else
    select id into v_id from poi_sop_progress where deal_id = p_deal_id;
  end if;

  return v_id;
end $$;

create or replace function brand_deals_poi_sop_ensure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kategori_poi in ('Accomodation','TTD') then
    perform poi_sop_ensure_progress(new.id, 15);
  elsif new.kategori_poi = 'Dining' and new.bentuk_kerjasama = 'Free/Barter' then
    perform poi_sop_ensure_progress(new.id, 17);
  end if;
  return null;
end $$;

drop trigger if exists trg_brand_deals_poi_sop_ensure on brand_deals;
create trigger trg_brand_deals_poi_sop_ensure
  after insert or update of kategori_poi, bentuk_kerjasama on brand_deals
  for each row execute function brand_deals_poi_sop_ensure();

-- Backfill: Dining/Free-Barter yang sudah ada sebelum migrasi ini (kosong saat
-- ini, tapi aman dijalankan untuk environment lain / data masa depan).
do $$
declare r record;
begin
  for r in select id from brand_deals where kategori_poi = 'Dining' and bentuk_kerjasama = 'Free/Barter' loop
    perform poi_sop_ensure_progress(r.id, 17);
  end loop;
end $$;

revoke execute on function poi_sop_ensure_progress(uuid, int) from public, anon, authenticated;

-- ---- 2) poi_dining_cycles + poi_dining_steps (Dining Berbayar, 22 step/siklus) ----
create table poi_dining_cycles (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references brand_deals(id) on delete cascade,
  cycle_no       int not null check (cycle_no >= 1),
  period_start   date not null,
  period_end     date not null check (period_end > period_start),
  ops_datetime   timestamptz,                 -- hanya bisa diisi setelah step 6 siklus ini selesai
  actual_vt      numeric check (actual_vt is null or actual_vt >= 0),
  total_gmv      numeric check (total_gmv is null or total_gmv >= 0),
  report_link    text,
  report_status  text check (report_status is null or report_status in
                    ('Approved','Waiting Confirmation','Request','Revisi')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz,
  unique (deal_id, cycle_no)
);

create index poi_dining_cycles_deal_idx on poi_dining_cycles (deal_id);

create table poi_dining_steps (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references poi_dining_cycles(id) on delete cascade,
  step_no       int not null check (step_no between 1 and 22),
  completed_at  timestamptz,
  completed_by  uuid references employees(id),
  skipped_at    timestamptz,                  -- hanya step 1-5, hanya diisi Director (trigger)
  skipped_by    uuid references employees(id),
  unique (cycle_id, step_no),
  constraint poi_dining_steps_skip_range check (skipped_at is null or step_no <= 5),
  constraint poi_dining_steps_state_xor check (completed_at is null or skipped_at is null)
);

create index poi_dining_steps_cycle_idx on poi_dining_steps (cycle_id);

-- ---- Auto-provision siklus bulanan + 22 step per siklus ---------------------
-- Jumlah siklus = selisih bulan kalender start..end, pola "tanggal-ke-tanggal"
-- (5 Sep -> 5 Des = 3 siklus persis). Sisa hari yang melewati tanggal awal
-- siklus berikutnya dihitung sebagai siklus tambahan (partial month).
create function poi_dining_ensure_cycles(p_deal_id uuid, p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_months int;
  v_cycle_id uuid;
  i int;
  v_period_start date;
  v_period_end date;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    return;
  end if;

  v_months := (extract(year from p_end)::int - extract(year from p_start)::int) * 12
            + (extract(month from p_end)::int - extract(month from p_start)::int);
  if extract(day from p_end) > extract(day from p_start) then
    v_months := v_months + 1;
  end if;
  if v_months < 1 then
    v_months := 1;
  end if;

  for i in 1..v_months loop
    v_cycle_id := null;
    v_period_start := (p_start + ((i - 1) || ' months')::interval)::date;
    v_period_end := least((p_start + (i || ' months')::interval)::date, p_end);

    insert into poi_dining_cycles (deal_id, cycle_no, period_start, period_end)
    values (p_deal_id, i, v_period_start, v_period_end)
    on conflict (deal_id, cycle_no) do nothing
    returning id into v_cycle_id;

    if v_cycle_id is not null then
      insert into poi_dining_steps (cycle_id, step_no)
      select v_cycle_id, s from generate_series(1, 22) s;
    end if;
  end loop;
end $$;

create function brand_deals_poi_dining_ensure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kategori_poi = 'Dining' and new.bentuk_kerjasama = 'Berbayar' then
    perform poi_dining_ensure_cycles(new.id, new.tanggal_mulai_kontrak, new.tanggal_akhir_kontrak);
  end if;
  return null;
end $$;

create trigger trg_brand_deals_poi_dining_ensure
  after insert or update of kategori_poi, bentuk_kerjasama, tanggal_mulai_kontrak, tanggal_akhir_kontrak
  on brand_deals
  for each row execute function brand_deals_poi_dining_ensure();

-- Backfill: Dining/Berbayar yang sudah ada sebelum migrasi ini.
do $$
declare r record;
begin
  for r in select id, tanggal_mulai_kontrak, tanggal_akhir_kontrak from brand_deals
           where kategori_poi = 'Dining' and bentuk_kerjasama = 'Berbayar' loop
    perform poi_dining_ensure_cycles(r.id, r.tanggal_mulai_kontrak, r.tanggal_akhir_kontrak);
  end loop;
end $$;

-- ---- poi_dining_steps: validasi opsional (1-5) / skip-approval / urutan (6+) ----
create function poi_dining_steps_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev_done boolean;
  v_unresolved int;
begin
  if old.completed_at is not null or old.skipped_at is not null then
    raise exception '[step sudah selesai/dilewati, tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  if new.skipped_at is not null then
    if new.step_no > 5 then
      raise exception '[hanya step 1-5 yang dapat dilewati]' using errcode = 'check_violation';
    end if;
    if not is_director() then
      raise exception '[hanya Director yang dapat menyetujui skip step ini]' using errcode = 'insufficient_privilege';
    end if;
    new.skipped_by := auth.uid();
  elsif new.completed_at is not null then
    if new.step_no = 6 then
      select count(*) into v_unresolved from poi_dining_steps
        where cycle_id = new.cycle_id and step_no between 1 and 5
          and completed_at is null and skipped_at is null;
      if v_unresolved > 0 then
        raise exception '[selesaikan atau lewati step 1-5 terlebih dahulu]' using errcode = 'check_violation';
      end if;
    elsif new.step_no > 6 then
      select (completed_at is not null) into v_prev_done
        from poi_dining_steps where cycle_id = new.cycle_id and step_no = new.step_no - 1;
      if not coalesce(v_prev_done, false) then
        raise exception '[selesaikan step sebelumnya terlebih dahulu]' using errcode = 'check_violation';
      end if;
    end if;
    new.completed_by := auth.uid();
  end if;
  return new;
end $$;

create trigger trg_poi_dining_steps_validate before update on poi_dining_steps
  for each row execute function poi_dining_steps_validate();

-- ---- poi_dining_cycles: Tanggal Ops hanya setelah step 6 selesai; jejak audit ----
create function poi_dining_cycles_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_step6_done boolean;
begin
  if new.ops_datetime is distinct from old.ops_datetime and new.ops_datetime is not null then
    select (completed_at is not null) into v_step6_done
      from poi_dining_steps where cycle_id = new.id and step_no = 6;
    if not coalesce(v_step6_done, false) then
      raise exception '[Tanggal Ops hanya dapat diisi setelah Step 6 selesai]' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger trg_poi_dining_cycles_validate before update on poi_dining_cycles
  for each row execute function poi_dining_cycles_validate();

create trigger trg_poi_dining_cycles_audit after insert or update on poi_dining_cycles
  for each row execute function capture_audit('poi_dining_cycle');
create trigger trg_poi_dining_steps_audit after insert or update on poi_dining_steps
  for each row execute function capture_audit('poi_dining_step');

-- ---- RLS: sama dengan gate BizDev Workspace (mgmt + divisi BizDev) ----------
alter table poi_dining_cycles enable row level security;
create policy poi_dining_cycles_select on poi_dining_cycles for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');
create policy poi_dining_cycles_update on poi_dining_cycles for update to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev')
  with check (is_od() or is_director() or auth_division() = 'BizDev');

alter table poi_dining_steps enable row level security;
create policy poi_dining_steps_select on poi_dining_steps for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');
create policy poi_dining_steps_update on poi_dining_steps for update to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev')
  with check (is_od() or is_director() or auth_division() = 'BizDev');

revoke execute on function poi_dining_ensure_cycles(uuid, date, date) from public, anon, authenticated;
revoke execute on function brand_deals_poi_dining_ensure()            from public, anon, authenticated;
revoke execute on function poi_dining_steps_validate()                 from public, anon, authenticated;
revoke execute on function poi_dining_cycles_validate()                from public, anon, authenticated;
