-- =============================================================================
-- MSDPS · M1 · Migration 0370 — Lead dari form meago.id: masuk tanpa BD + "Ambil Lead"
-- =============================================================================
-- Kenapa ada: pendaftar merchant/brand di meago.id masuk otomatis ke Pool Lead
-- (sumber 'Website MEAGO', migrasi 0369). Saat masuk BELUM ADA BD yang
-- memegangnya — itu justru informasinya: BizDev melihat daftar "Belum diproses"
-- lalu salah satu BD menekan "Ambil Lead" (keputusan Yohan 2026-10-19).
--
--   1. leads_validate(): SATU pelonggaran — lead ber-brand dengan sumber
--      'Website MEAGO' boleh tanpa bd_employee_id. Sumber lain TIDAK berubah:
--      intake BD manual tetap wajib "Nama BD". Badan fungsi selain itu disalin
--      persis dari 0331 (staging & production sudah dicek identik logikanya).
--   2. lead_web_attribution: atribusi web (CTA asal, URL, UTM, jumlah kiriman,
--      kiriman terakhir = "last touch") 1:1 per lead. Tabel terpisah supaya
--      kolom `leads` tidak berubah; ditulis HANYA oleh intake (service role).
--   3. claim_website_lead(): "Ambil Lead" atomik — mengisi BD = pemanggil
--      hanya bila BD masih kosong (dua BD klik bersamaan → satu menang, satu
--      dapat pesan jelas). Dijalankan dengan sesi pengguna sehingga audit_log
--      (trg_leads_audit) mencatat actor = BD yang mengambil.
-- Idempoten dan aman dijalankan berulang.
-- =============================================================================

-- ---- 1. Validasi lead: sumber 'Website MEAGO' boleh tanpa BD ----------------
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
    -- Intake BD: hanya Nama BD + Brand yang wajib. Pengecualian (0370): lead
    -- dari form meago.id masuk tanpa BD dan menunggu "Ambil Lead".
    if new.bd_employee_id is null and new.source is distinct from 'Website MEAGO' then
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

-- ---- 2. Atribusi web per lead -----------------------------------------------
create table if not exists lead_web_attribution (
  lead_id      uuid primary key references leads(id) on delete cascade,
  cta_id       text,
  source_url   text,
  referrer     text,
  utm          jsonb not null default '{}'::jsonb,
  first_wp_ref text,
  last_wp_ref  text,
  submissions  integer not null default 1 check (submissions >= 1),
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now()
);

create index if not exists lead_web_attribution_cta_idx on lead_web_attribution (cta_id);

comment on table lead_web_attribution is
  'Atribusi form meago.id per lead (1:1). first_* = kiriman pertama, last_* = kiriman terakhir (last-touch). Ditulis hanya oleh meago_intake_apply (service role). Migrasi 0370.';

alter table lead_web_attribution enable row level security;

drop policy if exists lead_web_attribution_select on lead_web_attribution;
create policy lead_web_attribution_select on lead_web_attribution for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));

-- ---- 3. "Ambil Lead" untuk lead tanpa BD -------------------------------------
create or replace function claim_website_lead(p_lead_id uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception '[tidak terautentikasi]' using errcode = 'insufficient_privilege';
  end if;
  if not (auth_division() = 'BizDev' or is_od() or is_director()) then
    raise exception '[hanya BizDev yang dapat mengambil lead]' using errcode = 'insufficient_privilege';
  end if;

  update leads
     set bd_employee_id = auth.uid()
   where id = p_lead_id
     and bd_employee_id is null
  returning id into v_id;

  if v_id is null then
    if exists (select 1 from leads where id = p_lead_id) then
      raise exception '[lead ini sudah diambil BD lain]' using errcode = 'check_violation';
    end if;
    raise exception '[lead tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  return v_id;
end $$;

comment on function claim_website_lead(uuid) is
  'Ambil Lead: isi bd_employee_id = pemanggil bila masih kosong. BizDev/OD/Director. Audit via trg_leads_audit (actor = pemanggil). Migrasi 0370.';

revoke execute on function claim_website_lead(uuid) from public, anon;
grant execute on function claim_website_lead(uuid) to authenticated;
