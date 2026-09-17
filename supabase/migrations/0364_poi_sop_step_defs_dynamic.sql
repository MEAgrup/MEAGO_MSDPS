-- =============================================================================
-- MSDPS · Setting Bizdev & Admin Ops · Migration 0364 — step SOP jadi dinamis
-- =============================================================================
-- Sebelumnya (0343) tab "Setting Bizdev & Admin Ops" hanya bisa menimpa
-- sla_days/sla_label per step — step/task sendiri dikunci ke array hardcoded
-- lib/mcn/poi-sop.ts + check constraint poi_sop_steps/poi_dining_steps
-- (step_no 1..15/17/22). Migrasi ini menjadikan poi_sla_settings (di-rename
-- poi_sop_step_defs) sebagai SATU-SATUNYA sumber kebenaran step per flow —
-- Director sekarang bisa menambah, mengedit, dan menonaktifkan step lewat UI.
--
-- Desain supaya AMAN terhadap deal yang sedang berjalan (progress tracking
-- live tidak boleh rusak):
--  - Step BARU selalu ditambahkan di AKHIR urutan flow (step_no = max+1) —
--    tidak pernah menyisip/merenumber step yang sudah ada, jadi riwayat
--    step_no di poi_sop_steps/poi_dining_steps tidak pernah berubah makna.
--  - "Hapus" = SOFT DELETE (active=false) — baris riwayat poi_sop_steps/
--    poi_dining_steps utk step itu TIDAK dihapus, cuma disembunyikan &
--    dikeluarkan dari hitungan total/urutan aktif ke depannya.
--  - Menambah step baru MENYEBARKAN (propagate) satu baris step baru (belum
--    selesai) ke SEMUA progress/cycle yang sudah ada utk flow itu — termasuk
--    deal lama — via fungsi SECURITY DEFINER (pola sama dgn provisioning yang
--    sudah ada), karena poi_sop_steps/poi_dining_steps tidak punya policy
--    INSERT utk role authenticated.
--  - Constraint "step_no between 1..N" (N tetap/hardcoded) diganti "step_no
--    >= 1" karena jumlah step kini dinamis per flow.
--  - Step 1-5 "opsional" Dining Berbayar sebelumnya hardcoded by position;
--    sekarang jadi kolom is_optional (dipindah dari 0343 seed), dan trigger
--    poi_dining_steps_validate/poi_dining_cycles_validate dibaca dari sini,
--    bukan angka "5"/"6" hardcoded — supaya tetap benar walau step ditambah.
-- =============================================================================

-- ---- 1) poi_sla_settings -> poi_sop_step_defs -------------------------------
alter table poi_sla_settings rename to poi_sop_step_defs;

alter table poi_sop_step_defs add column is_optional boolean not null default false;
alter table poi_sop_step_defs add column active boolean not null default true;
alter table poi_sop_step_defs add column created_at timestamptz not null default now();
alter table poi_sop_step_defs add column created_by uuid references employees(id) on delete set null;

-- Step 1-5 Dining Berbayar (MOU/Invoice/Payment) — opsional & boleh di-skip
-- (dulu hardcoded DINING_BERBAYAR_OPTIONAL_STEPS_END di lib/mcn/poi-sop.ts).
update poi_sop_step_defs set is_optional = true
  where flow = 'poi_dining_berbayar' and step_no <= 5;

drop policy poi_sla_settings_select on poi_sop_step_defs;
drop policy poi_sla_settings_manage on poi_sop_step_defs;

create policy poi_sop_step_defs_select on poi_sop_step_defs for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');

-- Update baris existing (task/sla_days/sla_label/is_optional/active) tetap
-- lewat RLS langsung (director-only) — TIDAK menyentuh step_no/propagasi, jadi
-- tidak butuh RPC. Insert/delete TIDAK diizinkan dari sini sama sekali —
-- insert step baru wajib lewat RPC poi_sop_step_defs_add di bawah (supaya
-- step_no & propagasi konsisten), dan hapus permanen tidak pernah diizinkan
-- (soft-delete via update active=false).
create policy poi_sop_step_defs_update on poi_sop_step_defs for update to authenticated
  using (is_director())
  with check (is_director());

-- ---- 2) poi_sop_steps / poi_dining_steps: lepas batas atas step_no tetap ----
alter table poi_sop_steps drop constraint poi_sop_steps_step_no_check;
alter table poi_sop_steps add constraint poi_sop_steps_step_no_check check (step_no >= 1);

alter table poi_dining_steps drop constraint poi_dining_steps_step_no_check;
alter table poi_dining_steps add constraint poi_dining_steps_step_no_check check (step_no >= 1);

-- ---- 3) poi_sop_ensure_progress: generate dari poi_sop_step_defs, bukan generate_series tetap ----
drop function if exists poi_sop_ensure_progress(uuid, int);

create function poi_sop_ensure_progress(p_deal_id uuid, p_flow text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into poi_sop_progress (deal_id) values (p_deal_id)
  on conflict (deal_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into poi_sop_steps (progress_id, step_no)
    select v_id, step_no from poi_sop_step_defs where flow = p_flow and active order by step_no;
  else
    select id into v_id from poi_sop_progress where deal_id = p_deal_id;
  end if;

  return v_id;
end $$;

create or replace function brand_deals_poi_sop_ensure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kategori_poi in ('Accomodation','TTD') then
    perform poi_sop_ensure_progress(new.id, 'poi_accommodation_ttd');
  elsif new.kategori_poi = 'Dining' and new.bentuk_kerjasama = 'Free/Barter' then
    perform poi_sop_ensure_progress(new.id, 'poi_dining_freebarter');
  end if;
  return null;
end $$;

revoke execute on function poi_sop_ensure_progress(uuid, text) from public, anon, authenticated;

-- ---- 4) poi_dining_ensure_cycles: 22 step tetap -> poi_sop_step_defs -------
create or replace function poi_dining_ensure_cycles(p_deal_id uuid, p_start date, p_end date)
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
      select v_cycle_id, step_no from poi_sop_step_defs where flow = 'poi_dining_berbayar' and active order by step_no;
    end if;
  end loop;
end $$;

-- ---- 5) poi_dining_steps_validate: opsional/urutan dibaca dari step defs, bukan angka 5/6 tetap ----
create or replace function poi_dining_steps_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev_done boolean;
  v_unresolved int;
  v_is_optional boolean;
  v_first_seq_step int;
begin
  if old.completed_at is not null or old.skipped_at is not null then
    raise exception '[step sudah selesai/dilewati, tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  select is_optional into v_is_optional from poi_sop_step_defs
    where flow = 'poi_dining_berbayar' and step_no = new.step_no;

  if new.skipped_at is not null then
    if not coalesce(v_is_optional, false) then
      raise exception '[hanya step opsional yang dapat dilewati]' using errcode = 'check_violation';
    end if;
    if not is_director() then
      raise exception '[hanya Director yang dapat menyetujui skip step ini]' using errcode = 'insufficient_privilege';
    end if;
    new.skipped_by := auth.uid();
  elsif new.completed_at is not null then
    select min(step_no) into v_first_seq_step from poi_sop_step_defs
      where flow = 'poi_dining_berbayar' and active and not is_optional;

    if v_first_seq_step is not null and new.step_no = v_first_seq_step then
      select count(*) into v_unresolved from poi_dining_steps pds
        join poi_sop_step_defs d on d.flow = 'poi_dining_berbayar' and d.step_no = pds.step_no
        where pds.cycle_id = new.cycle_id and d.is_optional
          and pds.completed_at is null and pds.skipped_at is null;
      if v_unresolved > 0 then
        raise exception '[selesaikan atau lewati step opsional terlebih dahulu]' using errcode = 'check_violation';
      end if;
    elsif v_first_seq_step is not null and new.step_no > v_first_seq_step then
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

-- ---- 6) poi_dining_cycles_validate: gerbang "Tanggal Ops" dibaca dari step defs, bukan "step 6" tetap ----
create or replace function poi_dining_cycles_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first_seq_step int;
  v_step_done boolean;
begin
  if new.ops_datetime is distinct from old.ops_datetime and new.ops_datetime is not null then
    select min(step_no) into v_first_seq_step from poi_sop_step_defs
      where flow = 'poi_dining_berbayar' and active and not is_optional;

    if v_first_seq_step is null then
      v_step_done := true; -- tidak ada step sequential terdefinisi — jangan blokir
    else
      select (completed_at is not null) into v_step_done
        from poi_dining_steps where cycle_id = new.id and step_no = v_first_seq_step;
    end if;

    if not coalesce(v_step_done, false) then
      raise exception '[Tanggal Ops hanya dapat diisi setelah step operasional pertama selesai]' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

-- ---- 7) RPC: tambah step baru (Director), selalu di akhir urutan flow -------
create function poi_sop_step_defs_add(
  p_flow text,
  p_task text,
  p_sla_days int,
  p_sla_label text,
  p_is_optional boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_step_no int;
  v_id uuid;
begin
  if not is_director() then
    raise exception '[hanya Director yang dapat menambah step SOP]' using errcode = 'insufficient_privilege';
  end if;
  if p_flow not in ('poi_accommodation_ttd', 'poi_dining_freebarter', 'poi_dining_berbayar') then
    raise exception '[flow tidak dikenal]' using errcode = 'check_violation';
  end if;
  if p_task is null or btrim(p_task) = '' then
    raise exception '[task wajib diisi]' using errcode = 'check_violation';
  end if;
  if p_sla_days is not null and p_sla_days < 0 then
    raise exception '[jumlah hari SLA tidak valid]' using errcode = 'check_violation';
  end if;

  select coalesce(max(step_no), 0) + 1 into v_step_no from poi_sop_step_defs where flow = p_flow;

  insert into poi_sop_step_defs (flow, step_no, task, sla_days, sla_label, is_optional, created_by, updated_by)
  values (p_flow, v_step_no, btrim(p_task), p_sla_days, nullif(btrim(coalesce(p_sla_label, '')), ''), coalesce(p_is_optional, false), auth.uid(), auth.uid())
  returning id into v_id;

  if p_flow in ('poi_accommodation_ttd', 'poi_dining_freebarter') then
    insert into poi_sop_steps (progress_id, step_no)
    select psp.id, v_step_no
    from poi_sop_progress psp
    join brand_deals bd on bd.id = psp.deal_id
    where (p_flow = 'poi_accommodation_ttd' and bd.kategori_poi in ('Accomodation', 'TTD'))
       or (p_flow = 'poi_dining_freebarter' and bd.kategori_poi = 'Dining' and bd.bentuk_kerjasama = 'Free/Barter')
    on conflict (progress_id, step_no) do nothing;
  elsif p_flow = 'poi_dining_berbayar' then
    insert into poi_dining_steps (cycle_id, step_no)
    select pdc.id, v_step_no from poi_dining_cycles pdc
    on conflict (cycle_id, step_no) do nothing;
  end if;

  return v_id;
end $$;

revoke execute on function poi_sop_step_defs_add(text, text, int, text, boolean) from public, anon;
grant execute on function poi_sop_step_defs_add(text, text, int, text, boolean) to authenticated;
