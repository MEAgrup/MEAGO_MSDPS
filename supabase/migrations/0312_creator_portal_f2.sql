-- =============================================================================
-- MSDPS · MCN · Migration 0312 — Creator Portal Fase F.2 (interview 2026-07-17)
-- =============================================================================
-- Keputusan Yohan (QA F.1):
--   · Merchant Deals : menu portal (eks "Agency Plan") menampilkan deal BizDev
--                      (brand_deals 0305). brand_deals + kebutuhan kreator/video/
--                      lokasi POI (info-only, OPSIONAL — pola 0310 special_projects).
--                      Kreator membaca via view definer v_portal_deals: kolom aman
--                      saja (TANPA komisi MEA/gmv_tap/service_fee), hanya status
--                      running, gate auth_creator_id().
--   · Report Saya    : file diupload tim CM, diakses kreator ybs. Metadata di
--                      creator_reports (RLS: CM kelola — staff scope owner, Lead
--                      lintas, mgmt; kreator select-only baris sendiri). File di
--                      bucket privat `creator-reports` path <mcn_creator_id>/...;
--                      akses file HANYA via service-role di server action (tidak
--                      ada policy storage.objects — bucket tertutup total untuk
--                      client anon/authenticated).
--   · Komplain       : tabel BARU creator_complaints (M6 complaints tetap milik
--                      Account/merchant — tidak disentuh). Routing ke CM owner:
--                      staff CM hanya lihat komplain kreator miliknya, Lead CM
--                      lintas, mgmt semua. Kreator insert + select miliknya;
--                      TANPA update/delete kreator.
--   · Form request   : CM & kreator sama-sama boleh buat — sudah berlaku di DB
--                      (policy 0306 + 0311, check union 0311). Perubahan UI saja.
-- =============================================================================

-- ---- Merchant Deals: kebutuhan deal (info-only, opsional) -------------------
alter table brand_deals
  add column kreators_needed int,
  add column videos_needed   int,
  add column poi_location    text;

comment on column brand_deals.kreators_needed is
  'Jumlah kreator dibutuhkan (info portal — tanpa hitung realisasi).';
comment on column brand_deals.videos_needed is
  'Target jumlah video deal (info portal — tanpa hitung realisasi).';
comment on column brand_deals.poi_location is
  'Lokasi POI deal (teks bebas satu baris).';

-- View definer (pola v_portal_merchants 0311): kolom aman utk kreator, hanya
-- deal running, baris hanya keluar untuk sesi kreator.
create view v_portal_deals as
  select id, code, brand_name, niche, campaign_type, komisi_kreator_pct,
         kreators_needed, videos_needed, poi_location, deal_end, created_at
  from brand_deals
  where status = 'running' and auth_creator_id() is not null;

comment on view v_portal_deals is
  'Merchant Deals portal kreator (F.2). Kolom terbatas — tanpa komisi MEA/gmv/fee. Hanya deal running, hanya sesi kreator.';

revoke all on v_portal_deals from public, anon;
grant select on v_portal_deals to authenticated;

-- ---- Report Saya: metadata file report --------------------------------------
create table creator_reports (
  id             uuid primary key default gen_random_uuid(),
  mcn_creator_id uuid not null references mcn_creators(id) on delete cascade,
  title          text not null,
  file_path      text not null,                    -- path di bucket creator-reports
  uploaded_by    uuid default auth.uid() references employees(id),
  created_at     timestamptz not null default now()
);

create index creator_reports_creator_idx on creator_reports (mcn_creator_id, created_at desc);

comment on table creator_reports is
  'Report Saya (portal F.2): file report per kreator, diupload tim CM. File di bucket privat creator-reports (akses via service-role server action).';

alter table creator_reports enable row level security;

-- Internal: CM (staff scope owner utk insert — mirror creator_requests_insert 0306),
-- Lead CM lintas, mgmt semua.
create policy creator_reports_select_internal on creator_reports
  for select to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');

create policy creator_reports_insert_internal on creator_reports
  for insert to authenticated
  with check (
    is_od() or is_director()
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );

create policy creator_reports_delete_internal on creator_reports
  for delete to authenticated
  using (
    is_od() or is_director() or uploaded_by = auth_emp_id()
    or (auth_division() = 'CreatorManagement' and is_lead())
  );

-- Kreator: select-only baris miliknya.
create policy creator_reports_select_creator_self on creator_reports
  for select to authenticated using (mcn_creator_id = auth_creator_id());

-- Bucket privat. TANPA policy storage.objects: anon/authenticated tidak bisa
-- menyentuh file sama sekali — semua akses file lewat service-role server action
-- yang lebih dulu memverifikasi hak lewat SELECT metadata ber-RLS.
insert into storage.buckets (id, name, public)
values ('creator-reports', 'creator-reports', false)
on conflict (id) do nothing;

-- ---- Komplain & Feedback: creator_complaints (tabel baru, M6 tak disentuh) --
create table creator_complaints (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- KOM-YYYYMM-NNNN
  mcn_creator_id    uuid not null references mcn_creators(id),
  subject           text,
  body              text not null,
  status            text not null default 'baru'
                      check (status in ('baru','diproses','selesai')),
  handled_by        uuid references employees(id),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

create index creator_complaints_creator_idx on creator_complaints (mcn_creator_id, status);

comment on table creator_complaints is
  'Komplain & Feedback portal kreator (F.2) — antrian CM owner. Terpisah dari complaints M6 (merchant/Account).';

create or replace function creator_complaints_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mcn_creator_id is null or new.body is null or btrim(new.body) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code('KOM');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_by := auth_emp_id();
    new.status_changed_at := now();
    if new.status <> 'baru' and new.handled_by is null then
      new.handled_by := auth_emp_id();
    end if;
  end if;
  return new;
end $$;

create trigger trg_creator_complaints_validate before insert or update on creator_complaints
  for each row execute function creator_complaints_validate();

revoke execute on function creator_complaints_validate() from public, anon, authenticated;

alter table creator_complaints enable row level security;

-- Kreator: ajukan + baca miliknya. Tanpa update/delete.
create policy creator_complaints_insert_creator_self on creator_complaints
  for insert to authenticated with check (mcn_creator_id = auth_creator_id());
create policy creator_complaints_select_creator_self on creator_complaints
  for select to authenticated using (mcn_creator_id = auth_creator_id());

-- Internal: staff CM hanya kreator miliknya (routing CM owner), Lead CM lintas, mgmt.
create policy creator_complaints_select_internal on creator_complaints
  for select to authenticated
  using (
    is_od() or is_director()
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );

create policy creator_complaints_update_internal on creator_complaints
  for update to authenticated
  using (
    is_od() or is_director()
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );
