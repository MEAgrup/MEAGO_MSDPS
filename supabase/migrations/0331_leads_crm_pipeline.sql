-- =============================================================================
-- MSDPS · Module 1 — Alur status CRM di "Leads & Prospek" (0331)
-- =============================================================================
-- Lanjutan migrasi 0330 (form intake BD). Tambahan kali ini:
--   * Wilayah (provinsi) pada form intake.
--   * "Jenis Usaha" jadi free text + tersimpan sebagai opsi baru untuk semua
--     user (tabel lead_business_types) — bukan enum tertutup lagi.
--   * Alur status CRM per-lead: Leads → Approaching → Follow Up → Dealing/
--     Rejected, dengan Renewal hanya dari Dealing. Field "Update Status Leads"
--     (approach_via, hasil_approach, benefit_dealing, nominal_bayar, durasi
--     kontrak, notes). Baris baru selalu mulai di status 'Leads'.
--   * "Benefit Dealing" free text + tersimpan sebagai opsi baru (tabel
--     lead_benefit_options), sama seperti jenis usaha.
--   * Kebijakan RLS delete untuk leads (belum ada sejak M1 — sekarang section
--     Pool Lead butuh hapus data + hapus massal).
--
-- Idempotent, supaya aman dijalankan ulang oleh scripts/apply_migrations.mjs.
-- =============================================================================

-- ---- Wilayah (provinsi) ------------------------------------------------------
alter table leads add column if not exists wilayah text;

do $$ begin
  alter table leads add constraint leads_wilayah_check check (
    wilayah is null or wilayah in (
      'Aceh','Bali','Banten','Bengkulu','Daerah Istimewa Yogyakarta',
      'Daerah Khusus Ibukota Jakarta','Gorontalo','Jambi','Jawa Barat',
      'Jawa Tengah','Jawa Timur','Kalimantan Barat','Kalimantan Selatan',
      'Kalimantan Tengah','Kalimantan Timur','Kalimantan Utara',
      'Kepulauan Bangka Belitung','Kepulauan Riau','Lampung','Maluku',
      'Maluku Utara','Nusa Tenggara Barat','Nusa Tenggara Timur','Papua',
      'Papua Barat','Papua Barat Daya','Papua Pegunungan','Papua Selatan',
      'Papua Tengah','Riau','Sulawesi Barat','Sulawesi Selatan',
      'Sulawesi Tengah','Sulawesi Tenggara','Sulawesi Utara','Sumatera Barat',
      'Sumatera Selatan','Sumatera Utara'
    )
  );
exception when duplicate_object then null;
end $$;

-- ---- Jenis Usaha: dari enum tertutup jadi free text + opsi bersama ---------
alter table leads alter column business_type type text using business_type::text;
drop type if exists brand_business_type;

create table if not exists lead_business_types (
  brand_category brand_category not null,
  label          text not null,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  primary key (brand_category, label)
);
comment on table lead_business_types is
  'Opsi "Jenis Usaha" per kategori brand, dropdown + tambah manual (leads_validate menyimpan otomatis).';

alter table lead_business_types enable row level security;
do $$ begin
  create policy lead_business_types_select on lead_business_types
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

insert into lead_business_types (brand_category, label)
values
  ('Accomodation','ACC - Hotel'), ('Accomodation','ACC - Resort'),
  ('Accomodation','ACC - Villa'), ('Accomodation','ACC - Guest House'),
  ('Accomodation','ACC - Homestay'), ('Accomodation','ACC - Glamping'),
  ('Accomodation','ACC - Apartment'),
  ('Dining','Dining - Restoran'), ('Dining','Dining - Cafe'),
  ('Dining','Dining - Bakery & Pastry'), ('Dining','Dining - Dessert Shop'),
  ('Dining','Dining - Street Food/ Kuliner UMKM'), ('Dining','Dining - Food Court'),
  ('Dining','Dining - All You Can Eat (AYCE)'), ('Dining','Dining - Fine Dining'),
  ('Dining','Dining - Bar & Lounge'),
  ('TTD','TTD - Tempat Wisata Alam'), ('TTD','TTD - Theme Park'),
  ('TTD','TTD - Waterpark'), ('TTD','TTD - Kebun Binatang/ Aquarium'),
  ('TTD','TTD - Museum/ Galery Seni'), ('TTD','TTD - Camping Ground'),
  ('TTD','TTD - Karaoke'), ('TTD','TTD - Bioskop'), ('TTD','TTD - Game Center'),
  ('TTD','TTD - Bowling'), ('TTD','TTD - Billiard'), ('TTD','TTD - Spa & Massage'),
  ('TTD','TTD - Salon & Barbershop'), ('TTD','TTD - Klinik Kecantikan'),
  ('TTD','TTD - Fitness Center & Pilates Studio'), ('TTD','TTD - Shopping Center')
on conflict (brand_category, label) do nothing;

-- ---- Benefit Dealing: free text + opsi bersama ------------------------------
create table if not exists lead_benefit_options (
  label      text primary key,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
comment on table lead_benefit_options is
  'Opsi "Benefit Dealing", dropdown + tambah manual (leads_validate menyimpan otomatis).';

alter table lead_benefit_options enable row level security;
do $$ begin
  create policy lead_benefit_options_select on lead_benefit_options
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

insert into lead_benefit_options (label) values
  ('Accommodation - Free Stay'), ('Accommodation - Free Visit'),
  ('Dining - Free Meals'), ('Dining - Content Package'),
  ('Dining - Creator Package'), ('TTD - Free Ticket')
on conflict (label) do nothing;

-- ---- Alur status CRM ---------------------------------------------------------
alter table leads
  add column if not exists crm_status              text not null default 'Leads',
  add column if not exists approach_via             text,
  add column if not exists hasil_approach            text,
  add column if not exists benefit_dealing           text,
  add column if not exists nominal_bayar             numeric not null default 0,
  add column if not exists tanggal_mulai_kontrak      date,
  add column if not exists tanggal_akhir_kontrak      date,
  add column if not exists notes                     text,
  add column if not exists crm_status_changed_by     uuid,
  add column if not exists crm_status_changed_at     timestamptz;

do $$ begin
  alter table leads add constraint leads_crm_status_check
    check (crm_status in ('Leads','Approaching','Follow Up','Dealing','Rejected','Renewal'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table leads add constraint leads_approach_via_check
    check (approach_via is null or approach_via in
      ('Call','Email','Instagram DM','LinkedIn','TikTok DM','Visit','WhatsApp'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table leads add constraint leads_hasil_approach_check
    check (hasil_approach is null or hasil_approach in (
      'Belum dibalas',
      'Sudah dibalas - Sedang Dipertimbangkan',
      'Sudah dibalas - Tertarik',
      'Sudah dibalas - Ditolak',
      'Sudah dibalas - Scheculing Meeting',
      'Sudah dibalas - Meminta Proposal'
    ));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table leads add constraint leads_nominal_bayar_check check (nominal_bayar >= 0);
exception when duplicate_object then null;
end $$;

comment on column leads.crm_status is
  'Alur BD: Leads→Approaching→Follow Up→Dealing/Rejected (bebas urut, hanya panduan); Renewal wajib dari Dealing.';
comment on column leads.nominal_bayar is 'Nominal dealing. 0 = dealing barter/gratis (valid).';

-- ---- Validasi (leads_validate diperluas) ------------------------------------
create or replace function leads_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.brand_name        := nullif(btrim(new.brand_name), '');
  new.pic_name_position := nullif(btrim(new.pic_name_position), '');
  new.web_socmed_link   := nullif(btrim(new.web_socmed_link), '');
  new.pic_phone         := normalize_phone_62(new.pic_phone);
  new.business_type     := nullif(btrim(new.business_type), '');
  new.benefit_dealing   := nullif(btrim(new.benefit_dealing), '');
  new.notes             := nullif(btrim(new.notes), '');

  -- lead_name masih dipakai modul lain (papan prospek, merchant, kampanye), jadi
  -- untuk intake BD ia diturunkan dari nama brand — bukan diisi dari UI.
  if new.brand_name is not null and (new.lead_name is null or btrim(new.lead_name) = '') then
    new.lead_name := new.brand_name;
  end if;

  if new.phone_raw is not null then
    new.phone_normalized := normalize_phone_id(new.phone_raw);
  end if;

  if new.lead_name is null or btrim(new.lead_name) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if new.brand_name is not null then
    -- Intake BD: hanya Nama BD + Brand yang wajib.
    if new.bd_employee_id is null then
      raise exception '[nama BD wajib dipilih]' using errcode = 'check_violation';
    end if;
  else
    -- Jalur lama (impor CSV M1, lead shop MCN): aturan M1 asli tidak berubah.
    if new.phone_normalized is null or new.source is null then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;
    if new.source in ('Leads-Iklan','Broadcast','Event','Kulwa-Webinar','GO-Program')
       and new.origin_campaign_id is null then
      raise exception '[kampanye asal wajib untuk sumber ini]' using errcode = 'check_violation';
    end if;
  end if;

  -- Jenis usaha tetap dependent terhadap kategori brand (nilainya sendiri
  -- sekarang bebas — user boleh menambah baru dari form).
  if new.business_type is not null and new.brand_category is null then
    raise exception '[kategori brand wajib dipilih sebelum jenis usaha]'
      using errcode = 'check_violation';
  end if;

  -- Baris baru selalu mulai di status 'Leads', apa pun yang dikirim client.
  if tg_op = 'INSERT' then
    new.crm_status := 'Leads';
  end if;

  if tg_op = 'UPDATE' and new.crm_status is distinct from old.crm_status then
    if new.crm_status = 'Renewal' and old.crm_status is distinct from 'Dealing' then
      raise exception '[Renewal hanya dapat dipilih dari status Dealing]'
        using errcode = 'check_violation';
    end if;
    new.crm_status_changed_by := auth.uid();
    new.crm_status_changed_at := now();
  end if;

  if new.crm_status in ('Dealing','Renewal') and new.benefit_dealing is null then
    raise exception '[benefit dealing wajib diisi untuk status Dealing/Renewal]'
      using errcode = 'check_violation';
  end if;

  -- Opsi baru yang diketik manual (jenis usaha / benefit dealing) tersimpan
  -- untuk semua user berikutnya.
  if new.business_type is not null and new.brand_category is not null then
    insert into lead_business_types (brand_category, label)
      values (new.brand_category, new.business_type)
      on conflict (brand_category, label) do nothing;
  end if;
  if new.benefit_dealing is not null then
    insert into lead_benefit_options (label) values (new.benefit_dealing)
      on conflict (label) do nothing;
  end if;

  if new.code is null then
    new.code := next_code('LEAD');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function leads_validate() from public, anon, authenticated;

-- ---- RLS: delete (Pool Lead butuh hapus satuan + massal) --------------------
do $$ begin
  create policy leads_delete on leads for delete to authenticated
    using (auth_division() in ('BizDev','Marketing') or is_director());
exception when duplicate_object then null;
end $$;
