-- =============================================================================
-- MSDPS · MEAGO! · Migration 0371 — Intake meago.id + Prospek Kreator (`CPR-…`)
-- =============================================================================
-- Kenapa ada: form pendaftaran di meago.id (plugin WordPress meago-core) kini
-- dikirim ke Edge Function `meago-intake`. Setiap pendaftar jadi PROSPEK —
-- bukan akun. Akun portal hanya lahir untuk prospek yang CLOSING (migrasi 0372).
--
--   web_intake_events : log SEMUA kiriman (diterima, duplikat, uji, ditolak,
--                       error). wp_ref unik untuk yang 'accepted' → kiriman ulang
--                       dengan Idempotency-Key sama mengembalikan hasil yang sama
--                       tanpa baris baru. Ditulis hanya service role.
--   creator_prospects : pendaftar kreator. code CPR-YYYYMM-NNNN. Follow-up oleh
--                       divisi Acquisition. Alur:
--                         [Baru] → [Dihubungi] → [Proses Binding] → [Bound]
--                         cabang [Ditolak] (alasan wajib) dan [Tidak Respon].
--                       [Bound] WAJIB: tertaut ke mcn_creators DAN kreator itu
--                       binding_status = 'Bound creators' (definisi closing
--                       kreator = sudah binding agency TikTok GO lewat MEAGO!).
--                       Kreator yang sudah ada di mcn_creators (username TikTok
--                       sama, case-insensitive, tanpa "@") langsung ditautkan;
--                       bila sudah Bound, prospek masuk langsung [Bound] dan
--                       ditandai existing_bound.
--   meago_intake_apply(): satu transaksi untuk 1 kiriman — kreator →
--                       creator_prospects; dining/hotel/ttd → leads (sumber
--                       'Website MEAGO', tanpa BD, dedupe nomor WA) +
--                       lead_web_attribution (0370).
--
-- Status prospek diubah HANYA lewat RPC (tidak ada policy UPDATE) supaya setiap
-- perubahan lewat enforce_status_transition + capture_audit dengan actor = staf.
-- Kontak kreator (WA/email) disimpan di sini saja — mcn_creators tidak diubah
-- (keputusan Yohan 2026-10-19).
-- Idempoten dan aman dijalankan berulang.
-- =============================================================================

-- ---- 1. Log intake ----------------------------------------------------------
create table if not exists web_intake_events (
  id          uuid primary key default gen_random_uuid(),
  event_id    text,
  wp_ref      text,
  site        text,
  type        text,
  outcome     text not null check (outcome in ('accepted','test','rejected','invalid','error')),
  payload     jsonb,
  result      jsonb,
  error       text,
  received_at timestamptz not null default now()
);

create unique index if not exists web_intake_events_wp_ref_accepted_uniq
  on web_intake_events (wp_ref) where outcome = 'accepted';
create index if not exists web_intake_events_received_idx on web_intake_events (received_at desc);

comment on table web_intake_events is
  'Log setiap POST ke Edge Function meago-intake. wp_ref unik untuk outcome accepted (idempotensi). rejected = tanda tangan/timestamp gagal (payload tidak dipercaya). Ditulis hanya service role. Migrasi 0371.';

alter table web_intake_events enable row level security;

do $$ begin
  create policy web_intake_events_select on web_intake_events for select to authenticated
    using (is_od() or is_director()
           or (is_lead() and auth_division() in ('Acquisition','BizDev')));
exception when duplicate_object then null; end $$;

-- ---- 2. Prospek kreator -----------------------------------------------------
create table if not exists creator_prospects (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                     -- CPR-YYYYMM-NNNN
  nama                   text not null,
  tiktok_username        text not null,                   -- lowercase, tanpa "@"
  email                  text,
  phone_raw              text,
  phone_normalized       text,                            -- 62xxxx (siap wa.me)
  followers_range        text,
  niche                  text,
  kota                   text,
  tiktok_go_status       text,
  binding_lain           text,
  usia_18                boolean,
  source                 text not null default 'Website',
  cta_id                 text,
  attribution            jsonb not null default '{}'::jsonb,
  wp_ref                 text,
  status                 text not null default '[Baru]',
  owner_id               uuid references employees(id),
  matched_mcn_creator_id uuid references mcn_creators(id),
  existing_bound         boolean not null default false,
  rejected_reason        text,
  rejected_note          text,
  acquisition_id         uuid references acquisitions(id),
  created_at             timestamptz not null default now(),
  created_by             uuid,                            -- NULL = dari intake web
  status_changed_by      uuid,
  status_changed_at      timestamptz
);

do $$ begin
  alter table creator_prospects add constraint creator_prospects_status_chk check (status in
    ('[Baru]','[Dihubungi]','[Proses Binding]','[Bound]','[Ditolak]','[Tidak Respon]'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table creator_prospects add constraint creator_prospects_source_chk check (source in
    ('Website','Referral','Event','Outbound','Lainnya'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table creator_prospects add constraint creator_prospects_rejected_reason_chk check (
    rejected_reason is null or rejected_reason in
      ('tidak memenuhi syarat','binding di agency lain','tidak respon','lainnya'));
exception when duplicate_object then null; end $$;

-- Satu prospek AKTIF per username; yang sudah Ditolak/Tidak Respon boleh daftar lagi.
create unique index if not exists creator_prospects_username_active_uniq
  on creator_prospects (tiktok_username)
  where status not in ('[Ditolak]','[Tidak Respon]');
create index if not exists creator_prospects_status_idx on creator_prospects (status);
create index if not exists creator_prospects_match_idx on creator_prospects (matched_mcn_creator_id);
create index if not exists creator_prospects_owner_idx on creator_prospects (owner_id);

comment on table creator_prospects is
  'Prospek kreator (pendaftar meago.id & sumber lain). Bukan akun. Follow-up Acquisition. [Bound] wajib tertaut mcn_creators ber-binding_status Bound creators. Status hanya lewat RPC creator_prospect_*. Migrasi 0371.';
comment on column creator_prospects.existing_bound is
  'true = saat intake username sudah ada di mcn_creators dan sudah Bound creators → prospek langsung [Bound].';

-- Normalisasi username TikTok: buang URL, "@", spasi, query; lowercase.
create or replace function normalize_tiktok_username(p text) returns text
  language sql immutable set search_path = public as $$
  select nullif(lower(regexp_replace(regexp_replace(regexp_replace(
           split_part(btrim(coalesce(p, '')), '?', 1),
           '^(https?://)?(www\.|m\.)?tiktok\.com/', '', 'i'),
           '^@+', ''), '/+$', '')), '')
$$;

create or replace function creator_prospects_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_binding text;
begin
  new.nama             := nullif(btrim(new.nama), '');
  new.tiktok_username  := normalize_tiktok_username(new.tiktok_username);
  new.email            := nullif(lower(btrim(new.email)), '');
  new.phone_normalized := normalize_phone_62(coalesce(nullif(btrim(new.phone_normalized), ''), new.phone_raw));

  if new.nama is null or new.tiktok_username is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.tiktok_username !~ '^[a-z0-9._]{2,24}$' then
    raise exception '[username TikTok tidak valid]' using errcode = 'check_violation';
  end if;

  if new.status = '[Ditolak]' and new.rejected_reason is null then
    raise exception '[alasan penolakan wajib diisi]' using errcode = 'check_violation';
  end if;
  if new.status <> '[Ditolak]' then
    new.rejected_reason := null;
    new.rejected_note   := null;
  end if;

  -- [Bound] = closing kreator: harus tertaut ke data kreator yang sudah Bound.
  if new.status = '[Bound]' and (tg_op = 'INSERT' or old.status is distinct from '[Bound]') then
    select binding_status into v_binding from mcn_creators where id = new.matched_mcn_creator_id;
    if new.matched_mcn_creator_id is null or v_binding is distinct from 'Bound creators' then
      raise exception '[belum bisa Bound: kreator harus tertaut ke Data Kreator dengan binding_status Bound creators]'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then
    new.code := next_code('CPR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function creator_prospects_validate() from public, anon, authenticated;

-- Urutan trigger (alfabetis): creator_prospects_validate → trg_..._status → trg_..._audit.
create or replace trigger creator_prospects_validate before insert or update on creator_prospects
  for each row execute function creator_prospects_validate();

create or replace trigger trg_creator_prospects_status before update on creator_prospects
  for each row execute function enforce_status_transition('creator_prospect');

create or replace trigger trg_creator_prospects_audit after insert or update on creator_prospects
  for each row execute function capture_audit('creator_prospect');

insert into status_transitions (entity, from_status, to_status, allowed_tokens, note) values
  ('creator_prospect','[Baru]','[Dihubungi]',              array['staff','lead','od','director'], 'Follow-up pertama'),
  ('creator_prospect','[Baru]','[Proses Binding]',         array['staff','lead','od','director'], null),
  ('creator_prospect','[Baru]','[Bound]',                  array['staff','lead','od','director'], 'Guard: tertaut + Bound creators'),
  ('creator_prospect','[Baru]','[Ditolak]',                array['staff','lead','od','director'], 'Alasan wajib'),
  ('creator_prospect','[Baru]','[Tidak Respon]',           array['staff','lead','od','director'], null),
  ('creator_prospect','[Dihubungi]','[Proses Binding]',    array['staff','lead','od','director'], null),
  ('creator_prospect','[Dihubungi]','[Bound]',             array['staff','lead','od','director'], 'Guard: tertaut + Bound creators'),
  ('creator_prospect','[Dihubungi]','[Ditolak]',           array['staff','lead','od','director'], 'Alasan wajib'),
  ('creator_prospect','[Dihubungi]','[Tidak Respon]',      array['staff','lead','od','director'], null),
  ('creator_prospect','[Proses Binding]','[Bound]',        array['staff','lead','od','director'], 'Guard: tertaut + Bound creators'),
  ('creator_prospect','[Proses Binding]','[Dihubungi]',    array['staff','lead','od','director'], null),
  ('creator_prospect','[Proses Binding]','[Ditolak]',      array['staff','lead','od','director'], 'Alasan wajib'),
  ('creator_prospect','[Proses Binding]','[Tidak Respon]', array['staff','lead','od','director'], null),
  ('creator_prospect','[Tidak Respon]','[Dihubungi]',      array['staff','lead','od','director'], 'Prospek merespons lagi'),
  ('creator_prospect','[Ditolak]','[Dihubungi]',           array['lead','od','director'],         'Buka ulang — hanya lead/management')
on conflict do nothing;

alter table creator_prospects enable row level security;

do $$ begin
  create policy creator_prospects_select on creator_prospects for select to authenticated
    using (is_od() or is_director() or auth_division() in ('Acquisition','CreatorManagement'));
exception when duplicate_object then null; end $$;
-- Tidak ada policy tulis apa pun: tulis hanya lewat RPC di bawah & intake.

-- ---- 3. RPC Acquisition -----------------------------------------------------
create or replace function creator_prospect_can_manage() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(is_od() or is_director() or auth_division() = 'Acquisition', false)
$$;

-- Tautkan prospek ke mcn_creators berdasarkan username (dipanggil intake & RPC).
create or replace function creator_prospect_match(p_username text) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from mcn_creators
   where platform = 'tiktok' and lower(username) = normalize_tiktok_username(p_username)
   limit 1
$$;

create or replace function creator_prospect_set_status(
  p_id uuid, p_status text, p_reason text default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_row creator_prospects;
begin
  if not creator_prospect_can_manage() then
    raise exception '[hanya Acquisition yang dapat mengubah status prospek]' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from creator_prospects where id = p_id for update;
  if not found then
    raise exception '[prospek tidak ditemukan]' using errcode = 'no_data_found';
  end if;

  -- Sebelum Bound, coba tautkan otomatis (kreator mungkin baru dibuat/di-ingest).
  if p_status = '[Bound]' and v_row.matched_mcn_creator_id is null then
    v_row.matched_mcn_creator_id := creator_prospect_match(v_row.tiktok_username);
  end if;

  update creator_prospects
     set status                 = p_status,
         matched_mcn_creator_id = v_row.matched_mcn_creator_id,
         rejected_reason        = case when p_status = '[Ditolak]' then nullif(btrim(p_reason), '') end,
         rejected_note          = case when p_status = '[Ditolak]' then nullif(btrim(p_note), '') end,
         owner_id               = coalesce(owner_id, case when auth_division() = 'Acquisition' then auth.uid() end)
   where id = p_id;
  return p_status;
end $$;

create or replace function creator_prospect_assign(p_id uuid, p_owner uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_current uuid;
begin
  if not creator_prospect_can_manage() then
    raise exception '[hanya Acquisition yang dapat mengatur PIC prospek]' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from employees where id = p_owner and division = 'Acquisition' and active) then
    raise exception '[PIC harus karyawan aktif divisi Acquisition]' using errcode = 'check_violation';
  end if;
  select owner_id into v_current from creator_prospects where id = p_id for update;
  if not found then
    raise exception '[prospek tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  -- Staff hanya boleh mengambil prospek yang belum ber-PIC untuk dirinya sendiri.
  if not (is_lead() or is_od() or is_director())
     and (p_owner <> auth.uid() or v_current is not null) then
    raise exception '[staff hanya dapat mengambil prospek yang belum ber-PIC untuk dirinya sendiri]'
      using errcode = 'insufficient_privilege';
  end if;
  update creator_prospects set owner_id = p_owner where id = p_id;
end $$;

create or replace function creator_prospect_link(p_id uuid, p_mcn_creator_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not creator_prospect_can_manage() then
    raise exception '[hanya Acquisition yang dapat menautkan prospek]' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from mcn_creators where id = p_mcn_creator_id) then
    raise exception '[data kreator tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  update creator_prospects set matched_mcn_creator_id = p_mcn_creator_id
   where id = p_id and status not in ('[Bound]','[Ditolak]');
  if not found then
    raise exception '[prospek tidak ditemukan atau sudah Bound/Ditolak]' using errcode = 'check_violation';
  end if;
end $$;

-- "Buat data kreator": insert mcn_creators dari data prospek (validasi
-- mcn_creators_validate tetap berlaku). Username sudah ada → tautkan saja.
create or replace function creator_prospect_create_creator(p_id uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_row creator_prospects; v_creator uuid;
begin
  if not creator_prospect_can_manage() then
    raise exception '[hanya Acquisition yang dapat membuat data kreator]' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from creator_prospects where id = p_id for update;
  if not found then
    raise exception '[prospek tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if v_row.status in ('[Ditolak]','[Tidak Respon]') then
    raise exception '[prospek Ditolak/Tidak Respon tidak dibuatkan data kreator]' using errcode = 'check_violation';
  end if;

  v_creator := coalesce(v_row.matched_mcn_creator_id, creator_prospect_match(v_row.tiktok_username));
  if v_creator is null then
    insert into mcn_creators (name, platform, username, niche, city, notes)
    values (v_row.nama, 'tiktok', v_row.tiktok_username, v_row.niche, v_row.kota,
            'Dari prospek ' || v_row.code || ' (' || v_row.source || ')')
    returning id into v_creator;
  end if;

  update creator_prospects set matched_mcn_creator_id = v_creator where id = p_id;
  return v_creator;
end $$;

-- "Catat Akuisisi (ACQ)": aplikasi mencatat akuisisi lewat alur yang SUDAH ADA
-- (recordAcquisition: snapshot komisi, baseline GMV, prospek→binding), lalu
-- menautkan baris acquisitions itu ke prospek di sini. Satu prospek = satu ACQ.
create or replace function creator_prospect_link_acquisition(p_id uuid, p_acquisition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row creator_prospects;
begin
  if not (is_od() or is_director() or auth_division() = 'Acquisition') then
    raise exception '[hanya Acquisition yang dapat mencatat akuisisi]' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from creator_prospects where id = p_id for update;
  if not found then
    raise exception '[prospek tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if v_row.status <> '[Bound]' or v_row.matched_mcn_creator_id is null then
    raise exception '[akuisisi hanya untuk prospek Bound yang tertaut]' using errcode = 'check_violation';
  end if;
  if v_row.acquisition_id is not null then
    raise exception '[akuisisi prospek ini sudah dicatat]' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from acquisitions
                  where id = p_acquisition_id and mcn_creator_id = v_row.matched_mcn_creator_id) then
    raise exception '[akuisisi tidak cocok dengan kreator prospek]' using errcode = 'check_violation';
  end if;
  update creator_prospects set acquisition_id = p_acquisition_id where id = p_id;
end $$;

revoke execute on function creator_prospect_can_manage(), creator_prospect_match(text),
  creator_prospect_set_status(uuid, text, text, text), creator_prospect_assign(uuid, uuid),
  creator_prospect_link(uuid, uuid), creator_prospect_create_creator(uuid),
  creator_prospect_link_acquisition(uuid, uuid) from public, anon;
grant execute on function creator_prospect_can_manage(), creator_prospect_match(text),
  creator_prospect_set_status(uuid, text, text, text), creator_prospect_assign(uuid, uuid),
  creator_prospect_link(uuid, uuid), creator_prospect_create_creator(uuid),
  creator_prospect_link_acquisition(uuid, uuid) to authenticated;

-- ---- 4. Intake: satu kiriman = satu transaksi --------------------------------
create or replace function meago_intake_apply(p_event jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_wp_ref   text := nullif(btrim(p_event->>'wp_ref'), '');
  v_type     text := lower(nullif(btrim(p_event->>'type'), ''));
  v_test     boolean := coalesce((p_event->>'test')::boolean, false);
  v_contact  jsonb := coalesce(p_event->'contact', '{}'::jsonb);
  v_fields   jsonb := coalesce(p_event->'fields', '{}'::jsonb);
  v_attr     jsonb := coalesce(p_event->'attribution', '{}'::jsonb);
  v_nama     text := nullif(btrim(v_contact->>'nama'), '');
  v_email    text := nullif(lower(btrim(v_contact->>'email')), '');
  v_wa_raw   text := nullif(btrim(v_contact->>'whatsapp_raw'), '');
  v_wa_norm  text := nullif(btrim(v_contact->>'whatsapp_normalized'), '');
  v_wa62     text;
  v_prev     jsonb;
  v_result   jsonb;
  v_user     text;
  v_creator  uuid;
  v_binding  text;
  v_pros     creator_prospects;
  v_lead_id  uuid;
  v_code     text;
  v_linked   boolean := false;
  v_cat      brand_category;
  v_kota     text;
  v_wilayah  text;
  v_notes    text;
  v_cta      text := nullif(btrim(v_attr->>'cta_id'), '');
  v_utm      jsonb;
begin
  if v_wp_ref is null then
    raise exception '[wp_ref wajib]' using errcode = 'check_violation';
  end if;
  if v_type is null or v_type not in ('kreator','dining','hotel','ttd') then
    raise exception '[type tidak dikenal]' using errcode = 'check_violation';
  end if;
  if v_nama is null or coalesce(v_wa_raw, v_wa_norm) is null then
    raise exception '[nama dan nomor WhatsApp wajib]' using errcode = 'check_violation';
  end if;
  if coalesce((v_fields->>'consent')::boolean, false) is not true then
    raise exception '[persetujuan (consent) wajib]' using errcode = 'check_violation';
  end if;
  v_wa62 := normalize_phone_62(coalesce(v_wa_norm, v_wa_raw));
  if v_wa62 !~ '^62[0-9]{8,13}$' then
    raise exception '[nomor WhatsApp tidak valid]' using errcode = 'check_violation';
  end if;
  v_utm := coalesce((select jsonb_object_agg(key, value) from jsonb_each(v_attr) where key like 'utm\_%'), '{}'::jsonb);

  -- Idempotensi: kiriman ulang wp_ref yang sama → hasil yang sama, tanpa tulisan baru.
  perform pg_advisory_xact_lock(hashtext('meago_intake:' || v_wp_ref));
  select result into v_prev from web_intake_events where wp_ref = v_wp_ref and outcome = 'accepted';
  if v_prev is not null then
    return v_prev;
  end if;

  if v_type = 'kreator' then
    v_user := normalize_tiktok_username(v_fields->>'tiktok_username');
    if v_user is null or v_user !~ '^[a-z0-9._]{2,24}$' then
      raise exception '[username TikTok tidak valid]' using errcode = 'check_violation';
    end if;
    v_creator := creator_prospect_match(v_user);
    select binding_status into v_binding from mcn_creators where id = v_creator;
    v_linked := v_creator is not null;

    if v_test then
      return jsonb_build_object('ok', true, 'test', true, 'kind', 'creator_prospect',
        'msdps_code', null, 'linked_existing', v_linked);
    end if;

    select * into v_pros from creator_prospects
     where tiktok_username = v_user and status not in ('[Ditolak]','[Tidak Respon]')
     for update;

    if found then
      -- Sudah ada prospek aktif: jangan buat baru; lengkapi kontak yang kosong.
      update creator_prospects
         set email            = coalesce(email, v_email),
             phone_raw        = coalesce(phone_raw, v_wa_raw),
             phone_normalized = coalesce(phone_normalized, v_wa62),
             matched_mcn_creator_id = coalesce(matched_mcn_creator_id, v_creator)
       where id = v_pros.id;
      v_code := v_pros.code;
    else
      insert into creator_prospects (
        nama, tiktok_username, email, phone_raw, phone_normalized, followers_range, niche,
        kota, tiktok_go_status, binding_lain, usia_18, source, cta_id, attribution, wp_ref,
        status, matched_mcn_creator_id, existing_bound)
      values (
        v_nama, v_user, v_email, v_wa_raw, v_wa62,
        nullif(btrim(v_fields->>'followers_range'), ''), nullif(btrim(v_fields->>'niche'), ''),
        nullif(btrim(v_fields->>'kota'), ''), nullif(btrim(v_fields->>'tiktok_go_status'), ''),
        nullif(btrim(v_fields->>'binding_lain'), ''), (v_fields->>'usia_18')::boolean,
        'Website', v_cta, v_attr, v_wp_ref,
        case when v_binding = 'Bound creators' then '[Bound]' else '[Baru]' end,
        v_creator, coalesce(v_binding = 'Bound creators', false))
      returning code into v_code;
    end if;

    v_result := jsonb_build_object('ok', true, 'kind', 'creator_prospect',
      'msdps_code', v_code, 'linked_existing', v_linked);

  else
    v_cat := case v_type when 'dining' then 'Dining' when 'hotel' then 'Accomodation' else 'TTD' end;
    if nullif(btrim(v_fields->>'nama_brand'), '') is null then
      raise exception '[nama brand wajib]' using errcode = 'check_violation';
    end if;

    select id, code into v_lead_id, v_code from leads
     where phone_normalized = normalize_phone_id(v_wa62)
     for update;
    v_linked := v_lead_id is not null;

    if v_test then
      return jsonb_build_object('ok', true, 'test', true, 'kind', 'merchant_lead',
        'msdps_code', v_code, 'linked_existing', v_linked);
    end if;

    v_kota := nullif(btrim(v_fields->>'kota'), '');
    v_wilayah := (select w from unnest(array['Aceh','Bali','Banten','Bengkulu',
      'Daerah Istimewa Yogyakarta','Daerah Khusus Ibukota Jakarta','Gorontalo','Jambi',
      'Jawa Barat','Jawa Tengah','Jawa Timur','Kalimantan Barat','Kalimantan Selatan',
      'Kalimantan Tengah','Kalimantan Timur','Kalimantan Utara','Kepulauan Bangka Belitung',
      'Kepulauan Riau','Lampung','Maluku','Maluku Utara','Nusa Tenggara Barat',
      'Nusa Tenggara Timur','Papua','Papua Barat','Papua Barat Daya','Papua Pegunungan',
      'Papua Selatan','Papua Tengah','Riau','Sulawesi Barat','Sulawesi Selatan',
      'Sulawesi Tengah','Sulawesi Tenggara','Sulawesi Utara','Sumatera Barat',
      'Sumatera Selatan','Sumatera Utara']) w where lower(w) = lower(v_kota) limit 1);

    v_notes := concat_ws(E'\n',
      '[Website MEAGO ' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') || ' · ' || v_wp_ref || ']',
      'Brand: ' || (v_fields->>'nama_brand') || coalesce(' · ' || nullif(btrim(v_fields->>'kategori'), ''), ''),
      'PIC: ' || v_nama || coalesce(' / ' || nullif(btrim(v_fields->>'jabatan'), ''), '')
        || coalesce(' · ' || v_email, '') || ' · ' || v_wa62,
      'Kota: ' || coalesce(v_kota, '-') || ' · Outlet: ' || coalesce(nullif(btrim(v_fields->>'jumlah_outlet'), ''), '-'),
      'TikTok GO: ' || coalesce(nullif(btrim(v_fields->>'tiktok_go_status'), ''), '-'),
      'Kebutuhan: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(
        case when jsonb_typeof(v_fields->'kebutuhan') = 'array' then v_fields->'kebutuhan' else '[]'::jsonb end) x), '-'),
      'Catatan: ' || coalesce(nullif(btrim(v_fields->>'catatan'), ''), '-'),
      'CTA: ' || coalesce(v_cta, '-') || coalesce(' · ' || nullif(btrim(v_attr->>'source_url'), ''), ''));

    if v_lead_id is not null then
      -- Dedupe nomor WA: tidak buat lead baru; catatan ditambahkan, last-touch diperbarui.
      update leads
         set notes = left(concat_ws(E'\n\n', notes, v_notes), 20000),
             email = coalesce(email, v_email)
       where id = v_lead_id;
    else
      insert into leads (lead_name, phone_raw, email, source, origin_type, status,
        brand_name, brand_category, business_type, pic_name_position, pic_phone,
        wilayah, notes)
      values (v_nama, coalesce(v_wa_raw, v_wa62), v_email, 'Website MEAGO', 'Pool', '[Pool]',
        btrim(v_fields->>'nama_brand'), v_cat, nullif(btrim(v_fields->>'kategori'), ''),
        v_nama || coalesce(' / ' || nullif(btrim(v_fields->>'jabatan'), ''), ''), v_wa62,
        v_wilayah, v_notes)
      returning id, code into v_lead_id, v_code;
    end if;

    insert into lead_web_attribution as a (lead_id, cta_id, source_url, referrer, utm,
      first_wp_ref, last_wp_ref)
    values (v_lead_id, v_cta, nullif(btrim(v_attr->>'source_url'), ''),
      nullif(btrim(v_attr->>'referrer'), ''), v_utm, v_wp_ref, v_wp_ref)
    on conflict (lead_id) do update
      set cta_id      = coalesce(a.cta_id, excluded.cta_id),         -- CTA asal (first-touch)
          source_url  = coalesce(a.source_url, excluded.source_url),
          referrer    = coalesce(a.referrer, excluded.referrer),
          utm         = a.utm || excluded.utm,
          last_wp_ref = excluded.last_wp_ref,
          submissions = a.submissions + 1,
          last_at     = now();

    v_result := jsonb_build_object('ok', true, 'kind', 'merchant_lead',
      'msdps_code', v_code, 'linked_existing', v_linked);
  end if;

  insert into web_intake_events (event_id, wp_ref, site, type, outcome, payload, result)
  values (p_event->>'event_id', v_wp_ref, p_event->>'site', v_type, 'accepted', p_event, v_result);
  return v_result;
end $$;

comment on function meago_intake_apply(jsonb) is
  'Dipanggil HANYA oleh Edge Function meago-intake (service role) setelah tanda tangan valid. Idempoten per wp_ref. test:true → validasi saja. Migrasi 0371.';

revoke execute on function meago_intake_apply(jsonb) from public, anon, authenticated;
grant execute on function meago_intake_apply(jsonb) to service_role;
revoke execute on function normalize_tiktok_username(text) from anon;
