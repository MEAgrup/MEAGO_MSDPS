-- =============================================================================
-- MSDPS · Module 1 — Form intake lead BD ("Leads & Prospek" → Daftarkan Lead)
-- =============================================================================
-- Form pendaftaran lead diganti total. Identitas lead sekarang: "Nama BD" +
-- "Brand / Merchant / POI" (dua-duanya wajib); kategori brand, jenis usaha,
-- source, PIC, kontak WA, dan link website/sosmed semuanya opsional.
--
-- Konsekuensi ke skema M1: nomor HP tidak lagi wajib (uniknya jadi partial
-- index) dan `source` boleh kosong. Jalur lama tetap hidup — impor CSV M1 dan
-- lead shop MCN (lib/actions/bizdev.ts) masih mengirim lead_name + phone_raw +
-- source tanpa brand_name — jadi validasi dibuat dua cabang:
--   * baris ber-brand_name  = intake BD  → bd_employee_id wajib
--   * baris tanpa brand_name = jalur lama → phone + source wajib (aturan M1 asli)
--
-- Nomor migrasi 0330 sengaja melompat: 0318–0322 sudah dipakai di branch
-- CRM Admin Ops / acquisition yang belum masuk main.
-- Idempotent, supaya aman dijalankan ulang oleh scripts/apply_migrations.mjs.
-- =============================================================================

-- ---- Taksonomi brand (dependent dropdown kategori → jenis usaha) ----
do $$ begin
  if not exists (select 1 from pg_type where typname = 'brand_category') then
    create type brand_category as enum ('Accomodation','Dining','TTD');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'brand_business_type') then
    create type brand_business_type as enum (
      'ACC - Hotel',
      'ACC - Resort',
      'ACC - Villa',
      'ACC - Guest House',
      'ACC - Homestay',
      'ACC - Glamping',
      'ACC - Apartment',
      'Dining - Restoran',
      'Dining - Cafe',
      'Dining - Bakery & Pastry',
      'Dining - Dessert Shop',
      'Dining - Street Food/ Kuliner UMKM',
      'Dining - Food Court',
      'Dining - All You Can Eat (AYCE)',
      'Dining - Fine Dining',
      'Dining - Bar & Lounge',
      'TTD - Tempat Wisata Alam',
      'TTD - Theme Park',
      'TTD - Waterpark',
      'TTD - Kebun Binatang/ Aquarium',
      'TTD - Museum/ Galery Seni',
      'TTD - Camping Ground',
      'TTD - Karaoke',
      'TTD - Bioskop',
      'TTD - Game Center',
      'TTD - Bowling',
      'TTD - Billiard',
      'TTD - Spa & Massage',
      'TTD - Salon & Barbershop',
      'TTD - Klinik Kecantikan',
      'TTD - Fitness Center & Pilates Studio',
      'TTD - Shopping Center'
    );
  end if;
end $$;

-- Source versi BD. 'Event' sudah ada di lead_source sejak M1; sisanya di sini.
alter type lead_source add value if not exists 'Outbound/Scouting Mandiri';
alter type lead_source add value if not exists 'Referal Internal';
alter type lead_source add value if not exists 'Referal Partner';
alter type lead_source add value if not exists 'Referal Creator';
alter type lead_source add value if not exists 'Referal TikTok GO';

-- ---- Normalisasi nomor WhatsApp: apa pun yang diketik, tersimpan berawalan 62 ----
-- Definisi sengaja identik dengan normalize_phone_62() milik modul CRM Admin Ops
-- (satu fungsi dipakai bersama, bukan dua fungsi kembar). Grant-nya tidak
-- di-revoke di sini supaya tidak menabrak ACL yang dipasang modul tersebut.
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
  'Normalisasi nomor HP Indonesia ke format 62xxxxxxxxx (tanpa +).';

-- ---- Kolom intake BD ----
alter table leads
  add column if not exists bd_employee_id    uuid references employees(id),
  add column if not exists brand_name        text,
  add column if not exists brand_category    brand_category,
  add column if not exists business_type     brand_business_type,
  add column if not exists pic_name_position text,
  add column if not exists pic_phone         text,
  add column if not exists web_socmed_link   text;

comment on column leads.bd_employee_id is 'Nama BD pengisi form intake (wajib untuk baris ber-brand_name).';
comment on column leads.brand_name is 'Brand / Merchant / POI. Menjadi sumber lead_name untuk baris intake BD.';
comment on column leads.pic_phone is 'Kontak PIC (WhatsApp); dinormalisasi trigger ke format "62…".';

alter table leads
  alter column phone_raw        drop not null,
  alter column phone_normalized drop not null,
  alter column source           drop not null;

-- Dedup nomor tetap berlaku, tapi hanya untuk baris yang memang punya nomor.
drop index if exists leads_phone_uniq;
create unique index leads_phone_uniq on leads (phone_normalized)
  where phone_normalized is not null;

create index if not exists leads_bd_employee_idx on leads (bd_employee_id);

-- ---- Validasi ----
create or replace function leads_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  expected_prefix text;
begin
  new.brand_name        := nullif(btrim(new.brand_name), '');
  new.pic_name_position := nullif(btrim(new.pic_name_position), '');
  new.web_socmed_link   := nullif(btrim(new.web_socmed_link), '');
  new.pic_phone         := normalize_phone_62(new.pic_phone);

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

  -- Jenis usaha wajib turunan dari kategori brand yang dipilih.
  if new.business_type is not null then
    if new.brand_category is null then
      raise exception '[kategori brand wajib dipilih sebelum jenis usaha]'
        using errcode = 'check_violation';
    end if;
    expected_prefix := case new.brand_category
                         when 'Accomodation' then 'ACC'
                         when 'Dining'       then 'Dining'
                         when 'TTD'          then 'TTD'
                       end;
    if split_part(new.business_type::text, ' - ', 1) is distinct from expected_prefix then
      raise exception '[jenis usaha tidak sesuai kategori brand]' using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then
    new.code := next_code('LEAD');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function leads_validate() from public, anon, authenticated;
