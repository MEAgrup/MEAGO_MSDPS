-- =============================================================================
-- MSDPS · Admin Ops CRM · Migration 0321 — CRM Leads (`CRM-…`) + Pendataan
-- Transaksi (`CRMTRX-…`)
-- =============================================================================
-- Adaptasi Web App Google Apps Script "Forms Leads Masuk & Dashboard CRM" (sheet
-- "Database Leads" + "Data Transaksi") ke dalam MSDPS. Tiga fitur inti yang
-- dipindahkan:
--   1. Forms Leads Masuk    -> insert crm_leads (status awal 'Leads')
--   2. Update Status        -> update crm_leads.status + stempel tanggal per status
--   3. Pendataan Transaksi  -> insert crm_transaksi (hanya lead Dealing/Renewal)
--
-- Kenapa TABEL BARU, bukan menumpang `leads`/`brand_deals`:
--   * `leads` + `prospect_attempts` (Module 1) adalah pool dedup-by-nomor dengan
--     mekanik kompetisi prospek — konsep yang berbeda total dari CRM scouting
--     brand/POI ini (satu baris per brand, tanpa dedup nomor, tanpa kompetisi).
--   * `brand_deals` adalah registry deal MCN yang direferensikan
--     live_schedule_slots, cooperating_shops, special_projects, dan portal
--     kreator. Mengubah bentuknya akan merusak modul-modul tersebut.
-- Jadi flow dua tab (`/leads`, `/deals`) dialihkan ke tabel baru ini, sementara
-- data & modul lama tetap utuh (masih bisa dibuka di section arsip pada UI).
--
-- Enforcement tetap di Postgres (Phase 0): ID lewat trigger setelah validasi,
-- code immutable, state machine data-driven, audit append-only, RLS per divisi.
-- =============================================================================

-- ---- Helper: normalisasi kontak ke format "62…" -----------------------------
-- Meniru formatContactPIC() di code.gs: buang non-digit, "0…" -> "62…", dan
-- prefix "62" bila belum ada. Berbeda dari normalize_phone_id() (Module 1) yang
-- menghasilkan "+62…" — CRM ini memakai format sheet lama supaya konsisten
-- dengan data yang sudah dipakai tim Admin Ops.
create or replace function normalize_phone_62(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then null
    when regexp_replace(p, '[^0-9]', '', 'g') = '' then null
    when regexp_replace(p, '[^0-9]', '', 'g') like '0%'
      then '62' || substr(regexp_replace(p, '[^0-9]', '', 'g'), 2)
    when regexp_replace(p, '[^0-9]', '', 'g') like '62%'
      then regexp_replace(p, '[^0-9]', '', 'g')
    else '62' || regexp_replace(p, '[^0-9]', '', 'g')
  end
$$;

comment on function normalize_phone_62(text) is
  'Normalisasi nomor HP Indonesia ke format "62…" (tanpa +). Meniru formatContactPIC() Apps Script.';

-- ---- Tabel: crm_leads -------------------------------------------------------
create table crm_leads (
  id                      uuid primary key default gen_random_uuid(),
  code                    text unique,                    -- CRM-YYYYMM-NNNN

  -- Forms Leads Masuk
  nama_bd                 text not null,
  bd_id                   uuid references employees(id),  -- terisi bila BD dipilih dari direktori
  tanggal_scouting        timestamptz not null default now(),
  brand                   text not null,                  -- Brand / Merchant / POI
  kategori_brand          text not null default 'Accommodation'
                            check (kategori_brand in ('Accommodation','Dining','TTD')),
  jenis_usaha             text,
  source                  text,
  wilayah                 text,                           -- provinsi
  nama_pic                text,                           -- nama & posisi PIC
  kontak_pic              text,                           -- dinormalisasi ke "62…"
  website_socmed          text,

  -- Update Status
  status                  text not null default 'Leads'
                            check (status in ('Leads','Approaching','Follow Up','Dealing','Rejected','Renewal')),
  approach_via            text,
  hasil_approach          text,
  tanggal_update_status   timestamptz not null default now(),

  -- Hanya relevan pada status Dealing / Renewal
  benefit_dealing         text,
  nominal_bayar           numeric not null default 0 check (nominal_bayar >= 0),
  tanggal_mulai_kontrak   date,
  tanggal_akhir_kontrak   date,
  notes_kontrak           text,

  -- Stempel waktu per status (kolom "Tanggal Status …" di sheet lama)
  tanggal_status_leads       timestamptz,
  tanggal_status_approaching timestamptz,
  tanggal_status_follow_up   timestamptz,
  tanggal_status_rejected    timestamptz,
  tanggal_status_dealing     timestamptz,
  tanggal_status_renewal     timestamptz,

  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  status_changed_by       uuid,
  status_changed_at       timestamptz
);

comment on table crm_leads is
  'CRM scouting brand/merchant/POI (Admin Ops). Satu baris per brand. Pengganti flow tab "Leads & Prospek".';
comment on column crm_leads.kontak_pic is 'Dinormalisasi trigger ke format "62…".';
comment on column crm_leads.nominal_bayar is 'Nominal dealing. 0 = dealing barter/gratis (valid).';

create index crm_leads_status_idx on crm_leads (status);
create index crm_leads_brand_idx on crm_leads (lower(brand));
create index crm_leads_bd_idx on crm_leads (bd_id);
create index crm_leads_created_idx on crm_leads (created_at desc);

-- ---- crm_leads: validasi + ID + stempel tanggal status ----------------------
create or replace function crm_leads_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nama_bd := nullif(btrim(coalesce(new.nama_bd, '')), '');
  new.brand   := nullif(btrim(coalesce(new.brand, '')), '');

  if new.nama_bd is null or new.brand is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  new.kontak_pic := normalize_phone_62(new.kontak_pic);

  -- Benefit dealing wajib begitu lead masuk status Dealing/Renewal (mirror
  -- validasi form "Update Status Brand" pada web app lama).
  if new.status in ('Dealing','Renewal') then
    if nullif(btrim(coalesce(new.benefit_dealing, '')), '') is null then
      raise exception '[benefit dealing wajib diisi untuk status %]', new.status
        using errcode = 'check_violation';
    end if;
  end if;

  -- Durasi kontrak opsional, tapi harus lengkap & urut bila diisi.
  if (new.tanggal_mulai_kontrak is null) <> (new.tanggal_akhir_kontrak is null) then
    raise exception '[durasi kontrak harus diisi lengkap: tanggal awal dan tanggal akhir]'
      using errcode = 'check_violation';
  end if;
  if new.tanggal_mulai_kontrak is not null
     and new.tanggal_mulai_kontrak > new.tanggal_akhir_kontrak then
    raise exception '[tanggal awal kontrak tidak boleh melebihi tanggal akhir]'
      using errcode = 'check_violation';
  end if;

  -- Stempel tanggal: INSERT selalu, UPDATE hanya saat status berubah.
  if tg_op = 'INSERT' then
    new.tanggal_update_status := coalesce(new.tanggal_update_status, now());
  elsif new.status is distinct from old.status then
    new.tanggal_update_status := now();
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status
      when 'Leads'       then new.tanggal_status_leads       := new.tanggal_update_status;
      when 'Approaching' then new.tanggal_status_approaching := new.tanggal_update_status;
      when 'Follow Up'   then new.tanggal_status_follow_up   := new.tanggal_update_status;
      when 'Rejected'    then new.tanggal_status_rejected    := new.tanggal_update_status;
      when 'Dealing'     then new.tanggal_status_dealing     := new.tanggal_update_status;
      when 'Renewal'     then new.tanggal_status_renewal     := new.tanggal_update_status;
      else null;  -- tidak mungkin (check constraint), tapi CASE tanpa ELSE akan raise
    end case;
  end if;

  -- ID hanya diterbitkan setelah semua validasi wajib lolos; setelah itu immutable.
  if new.code is null then
    new.code := next_code('CRM');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_crm_leads_validate before insert or update on crm_leads
  for each row execute function crm_leads_validate();
create trigger trg_crm_leads_status before update on crm_leads
  for each row execute function enforce_status_transition('crm_lead');
create trigger trg_crm_leads_audit after insert or update on crm_leads
  for each row execute function capture_audit('crm_lead');

-- ---- Transitions crm_lead ---------------------------------------------------
-- Alur normal: Leads -> Approaching -> Follow Up -> Dealing/Rejected, dengan
-- Renewal sebagai lanjutan dari Dealing. Web app lama membebaskan pilihan status
-- (dropdown 6 nilai), jadi transisi mundur/koreksi juga diizinkan — tetap lewat
-- engine supaya setiap perubahan tercatat aktor + waktunya. Yang TIDAK diizinkan:
-- lompat dari 'Leads' langsung ke 'Dealing'/'Renewal' tanpa jejak approach.
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('crm_lead','Leads','Approaching',        null),
  ('crm_lead','Leads','Follow Up',          null),
  ('crm_lead','Leads','Rejected',           null),
  ('crm_lead','Approaching','Follow Up',    null),
  ('crm_lead','Approaching','Dealing',      null),
  ('crm_lead','Approaching','Rejected',     null),
  ('crm_lead','Approaching','Leads',        null),
  ('crm_lead','Follow Up','Dealing',        null),
  ('crm_lead','Follow Up','Rejected',       null),
  ('crm_lead','Follow Up','Approaching',    null),
  ('crm_lead','Follow Up','Leads',          null),
  ('crm_lead','Dealing','Renewal',          null),
  ('crm_lead','Dealing','Rejected',         null),
  ('crm_lead','Dealing','Follow Up',        null),
  ('crm_lead','Renewal','Dealing',          null),
  ('crm_lead','Renewal','Rejected',         null),
  ('crm_lead','Renewal','Follow Up',        null),
  ('crm_lead','Rejected','Leads',           null),
  ('crm_lead','Rejected','Approaching',     null),
  ('crm_lead','Rejected','Follow Up',       null),
  ('crm_lead','Rejected','Dealing',         null)
on conflict (entity, from_status, to_status) do nothing;

-- ---- Tabel: crm_transaksi ---------------------------------------------------
create table crm_transaksi (
  id                      uuid primary key default gen_random_uuid(),
  code                    text unique,                    -- CRMTRX-YYYYMM-NNNN

  crm_lead_id             uuid not null references crm_leads(id) on delete restrict,
  tanggal_transaksi       timestamptz not null default now(),

  nama_bd                 text not null,
  bd_id                   uuid references employees(id),
  nama_ops                text not null,
  ops_id                  uuid references employees(id),

  kategori_poi            text not null
                            check (kategori_poi in ('Accommodation','Dining','TTD')),
  nama_poi                text not null,                  -- snapshot nama brand saat transaksi
  nama_pic_poi            text not null,
  kontak_wa               text not null,                  -- dinormalisasi ke "62…"

  bentuk_kerjasama        text not null
                            check (bentuk_kerjasama in ('Berbayar','Free')),
  nominal                 numeric not null default 0 check (nominal >= 0),
  benefit_diberikan       text not null,

  visit_mulai             timestamptz not null,
  visit_berakhir          timestamptz not null,
  jumlah_kreator          integer not null default 1 check (jumlah_kreator >= 1),
  jumlah_konten           integer check (jumlah_konten >= 0),
  total_jam_live          numeric check (total_jam_live >= 0),
  link_brief              text,

  -- Wajib khusus kategori POI = Dining (mirror toggleDurasiKerjasama()).
  durasi_kerjasama_mulai  date,
  durasi_kerjasama_akhir  date,

  is_bulk_import          boolean not null default false,

  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now()
);

comment on table crm_transaksi is
  'Pendataan transaksi POI dari lead CRM berstatus Dealing/Renewal. Pengganti flow tab "Merchant Deals".';
comment on column crm_transaksi.nama_poi is
  'Snapshot nama brand saat transaksi dicatat — nama di crm_leads boleh berubah tanpa mengubah histori.';
comment on column crm_transaksi.is_bulk_import is
  'TRUE bila baris berasal dari import massal (belum dilengkapi manual).';

create index crm_transaksi_lead_idx on crm_transaksi (crm_lead_id);
create index crm_transaksi_tanggal_idx on crm_transaksi (tanggal_transaksi desc);
create index crm_transaksi_kategori_idx on crm_transaksi (kategori_poi);
create index crm_transaksi_bd_idx on crm_transaksi (bd_id);

-- ---- crm_transaksi: validasi + ID -------------------------------------------
create or replace function crm_transaksi_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lead_status text;
  v_lead_brand  text;
begin
  select status, brand into v_lead_status, v_lead_brand
  from crm_leads where id = new.crm_lead_id;

  if v_lead_status is null then
    raise exception '[lead CRM tidak ditemukan]' using errcode = 'check_violation';
  end if;
  if v_lead_status not in ('Dealing','Renewal') then
    raise exception '[transaksi hanya boleh dicatat untuk lead berstatus Dealing atau Renewal (status saat ini: %)]', v_lead_status
      using errcode = 'check_violation';
  end if;

  new.nama_poi      := coalesce(nullif(btrim(coalesce(new.nama_poi, '')), ''), v_lead_brand);
  new.nama_bd       := nullif(btrim(coalesce(new.nama_bd, '')), '');
  new.nama_ops      := nullif(btrim(coalesce(new.nama_ops, '')), '');
  new.nama_pic_poi  := nullif(btrim(coalesce(new.nama_pic_poi, '')), '');
  new.kontak_wa     := normalize_phone_62(new.kontak_wa);
  new.benefit_diberikan := nullif(btrim(coalesce(new.benefit_diberikan, '')), '');

  if new.nama_bd is null or new.nama_ops is null or new.nama_pic_poi is null
     or new.kontak_wa is null or new.benefit_diberikan is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  -- Nominal: wajib > 0 untuk Berbayar, dipaksa 0 untuk Free/Barter.
  if new.bentuk_kerjasama = 'Berbayar' then
    if coalesce(new.nominal, 0) <= 0 then
      raise exception '[nominal deals wajib lebih dari 0 untuk kerja sama berbayar]'
        using errcode = 'check_violation';
    end if;
  else
    new.nominal := 0;
  end if;

  if new.visit_mulai > new.visit_berakhir then
    raise exception '[tanggal visit dimulai tidak boleh melebihi visit berakhir]'
      using errcode = 'check_violation';
  end if;

  -- Durasi kerjasama: wajib untuk Dining, dibersihkan untuk kategori lain.
  if new.kategori_poi = 'Dining' then
    if new.durasi_kerjasama_mulai is null or new.durasi_kerjasama_akhir is null then
      raise exception '[durasi kerjasama (tanggal awal & akhir) wajib untuk kategori POI Dining]'
        using errcode = 'check_violation';
    end if;
    if new.durasi_kerjasama_mulai > new.durasi_kerjasama_akhir then
      raise exception '[tanggal awal durasi kerjasama tidak boleh melebihi tanggal akhir]'
        using errcode = 'check_violation';
    end if;
  else
    new.durasi_kerjasama_mulai := null;
    new.durasi_kerjasama_akhir := null;
  end if;

  if new.code is null then
    new.code := next_code('CRMTRX');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_crm_transaksi_validate before insert or update on crm_transaksi
  for each row execute function crm_transaksi_validate();
create trigger trg_crm_transaksi_audit after insert or update on crm_transaksi
  for each row execute function capture_audit('crm_transaksi');

-- ---- RLS --------------------------------------------------------------------
-- crm_leads: audience baca = pemilik tab (/leads: BizDev, Marketing) + peran yang
-- perlu memilih POI di pendataan transaksi (/deals: CreatorManagement, Account).
-- Tulis = BizDev & Marketing (yang scouting) + management.
alter table crm_leads enable row level security;

create policy crm_leads_select on crm_leads for select to authenticated
  using (
    is_od() or is_director()
    or auth_division() in ('BizDev','Marketing','CreatorManagement','Account','Acquisition')
  );
create policy crm_leads_insert on crm_leads for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));
create policy crm_leads_update on crm_leads for update to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));
-- Hapus lead: hanya Lead/SPV BizDev & management (web app lama punya hapus massal;
-- di MSDPS aksinya dibatasi karena audit_log tidak menyimpan baris yang dihapus).
create policy crm_leads_delete on crm_leads for delete to authenticated
  using (is_od() or is_director() or (auth_division() = 'BizDev' and is_lead()));

-- crm_transaksi: audience sama dengan tab /deals.
alter table crm_transaksi enable row level security;

create policy crm_trx_select on crm_transaksi for select to authenticated
  using (
    is_od() or is_director()
    or auth_division() in ('BizDev','CreatorManagement','Account','Finance')
  );
create policy crm_trx_insert on crm_transaksi for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));
create policy crm_trx_update on crm_transaksi for update to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));
create policy crm_trx_delete on crm_transaksi for delete to authenticated
  using (is_od() or is_director() or (auth_division() = 'BizDev' and is_lead()));

-- Tabel baru tidak boleh terbaca anon (pola 0210b).
revoke all on crm_leads from anon;
revoke all on crm_transaksi from anon;
