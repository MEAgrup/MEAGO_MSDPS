-- =============================================================================
-- MSDPS · MCN · Migration 0311 — Creator Portal (Fase F.1): auth kreator + rework request
-- =============================================================================
-- Portal kreator /kreator (user eksternal, BUKAN karyawan):
--   · mcn_creators.auth_user_id : akun login kreator (dibuat admin, 1:1 auth.users).
--   · auth_creator_id()         : helper RLS identitas kreator (security definer).
--   · is_employee()             : kreator ikut role `authenticated`, jadi policy
--                                 `using (true)` lama ikut terbaca kreator →
--                                 diganti is_employee() di: employees, campaigns,
--                                 service_catalog, package_catalog, app_config,
--                                 working_calendar. Perilaku karyawan tidak berubah.
--   · creator_requests          : + jenis portal MEA GO (free_meal/visit/ads_live/
--                                 special_price_live). Jenis lama sample/ads/hsl
--                                 TETAP valid (form CM lama masih memakainya —
--                                 nasibnya pertanyaan terbuka F.2). + kolom
--                                 target_merchant_id (merchant M4) & nominal.
--                                 Gate cap ads_live DIPAKSA DI TRIGGER: kreator
--                                 tidak bisa menyetel needs_approval=false via API.
--   · v_portal_merchants        : picker merchant utk kreator — kolom terbatas
--                                 (tanpa gmv_baseline/target_gmv/total_revenue),
--                                 gate auth_creator_id() is not null.
--   · Policy creator-self (select-only) di mcn_creators, creator_period_summary,
--     special_projects, special_project_creators, creator_requests (+ insert baris
--     sendiri). Kreator TIDAK punya update/delete di mana pun.
-- =============================================================================

-- ---- Auth kreator -----------------------------------------------------------
alter table mcn_creators
  add column auth_user_id uuid unique references auth.users(id);

comment on column mcn_creators.auth_user_id is
  'Akun login portal kreator (auth.users). Dibuat admin via /meago/creators — tidak ada pendaftaran mandiri.';

-- Identitas kreator untuk RLS. SECURITY DEFINER agar tidak tersandung RLS
-- mcn_creators; STABLE agar bisa di-cache planner dalam satu statement.
create or replace function auth_creator_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from mcn_creators where auth_user_id = auth.uid()
$$;

-- Pembeda karyawan vs kreator: keduanya role `authenticated`.
create or replace function is_employee() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where id = auth.uid())
$$;

-- Pola 0008: helper RLS tetap executable `authenticated`, tapi bukan public/anon.
revoke execute on function auth_creator_id() from public, anon;
revoke execute on function is_employee()     from public, anon;

-- ---- Tutup policy `using (true)` dari kreator -------------------------------
-- Enam policy select internal yang tadinya terbuka untuk semua `authenticated`.
alter policy employees_select_all      on employees        using (is_employee());
alter policy campaigns_select          on campaigns        using (is_employee());
alter policy catalog_select            on service_catalog  using (is_employee());
alter policy package_select            on package_catalog  using (is_employee());
alter policy app_config_select         on app_config       using (is_employee());
alter policy working_calendar_select   on working_calendar using (is_employee());

-- ---- creator_requests: jenis portal MEA GO ----------------------------------
alter table creator_requests
  add column target_merchant_id uuid references merchants(id),
  add column nominal            numeric;

comment on column creator_requests.target_merchant_id is
  'Merchant M4 tujuan (free_meal/visit). Bila belum terdaftar, kreator isi target_brand (teks bebas).';
comment on column creator_requests.nominal is
  'Nominal request: budget ads (ads_live) / harga special (special_price_live).';

alter table creator_requests drop constraint creator_requests_type_check;
alter table creator_requests add constraint creator_requests_type_check
  check (type in ('sample','ads','hsl',
                  'free_meal','visit','ads_live','special_price_live'));

-- Validasi: sama dengan 0306 + gate cap ads_live dipaksa di DB — nominal null /
-- cap null / nominal > cap → needs_approval=true (approval Director, trigger 0306).
create or replace function creator_requests_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cap numeric;
begin
  if new.mcn_creator_id is null or new.type is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.type = 'ads_live' then
    select ads_budget_cap into v_cap from mcn_creators where id = new.mcn_creator_id;
    new.needs_approval := (v_cap is null) or (new.nominal is null) or (new.nominal > v_cap);
  end if;

  if tg_op = 'UPDATE' then
    -- Approval hanya boleh dilakukan Director.
    if new.approved_by is distinct from old.approved_by and new.approved_by is not null then
      if not is_director() then
        raise exception '[hanya Director yang dapat approve request]'
          using errcode = 'insufficient_privilege';
      end if;
      new.approved_at := coalesce(new.approved_at, now());
    end if;
    -- diajukan→diproses ditolak bila butuh approval tapi belum di-approve.
    if new.status = 'diproses' and old.status = 'diajukan'
       and new.needs_approval and new.approved_by is null then
      raise exception '[request ads melebihi budget cap — butuh approval Director]'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then
    new.code := next_code('REQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---- v_portal_merchants: picker merchant untuk kreator ----------------------
-- View definer (default Postgres): melewati RLS merchants milik karyawan, tapi
-- hanya kolom aman dan hanya untuk sesi kreator. Filter kategori dilakukan app
-- (kategori merchants = teks bebas, cocokkan case-insensitive).
create view v_portal_merchants as
  select id, nama_toko, kota, kategori
  from merchants
  where auth_creator_id() is not null;

comment on view v_portal_merchants is
  'Picker merchant portal kreator (F.1). Kolom terbatas — tanpa gmv/target/revenue. Baris hanya keluar utk sesi kreator.';

revoke all on v_portal_merchants from public, anon;
grant select on v_portal_merchants to authenticated;

-- ---- Policy creator-self (select-only) --------------------------------------
-- Baris sendiri di master kreator (tanpa helper: kolomnya ada di tabel ini).
create policy mcn_creators_select_creator_self on mcn_creators
  for select to authenticated using (auth_user_id = auth.uid());

-- Performa mingguan miliknya (menu Performa Saya).
create policy cps_select_creator_self on creator_period_summary
  for select to authenticated using (mcn_creator_id = auth_creator_id());

-- Assignment special project miliknya + project ybs (menu Special Project).
create policy spc_select_creator_self on special_project_creators
  for select to authenticated using (mcn_creator_id = auth_creator_id());

create policy special_projects_select_creator_self on special_projects
  for select to authenticated
  using (exists (select 1 from special_project_creators spc
                 where spc.project_id = special_projects.id
                   and spc.mcn_creator_id = auth_creator_id()));

-- Request miliknya: baca + ajukan. Tidak ada update/delete (status diproses BizDev).
create policy creator_requests_select_creator_self on creator_requests
  for select to authenticated using (mcn_creator_id = auth_creator_id());

create policy creator_requests_insert_creator_self on creator_requests
  for insert to authenticated with check (mcn_creator_id = auth_creator_id());
