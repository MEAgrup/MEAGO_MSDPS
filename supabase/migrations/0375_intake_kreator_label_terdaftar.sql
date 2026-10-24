-- =============================================================================
-- MSDPS · MEAGO! · Migration 0375 — Intake kreator: "sudah terdaftar" hanya label
-- =============================================================================
-- Revisi keputusan Yohan 2026-10-19 atas 0371: bila username TikTok pendaftar
-- sudah ada di Data Kreator (mcn_creators), intake TIDAK lagi menautkan prospek
-- (matched_mcn_creator_id) dan TIDAK lagi memberi status [Bound] otomatis.
-- Prospek selalu masuk [Baru]; aplikasi menampilkan label "sudah terdaftar"
-- (dicocokkan username saat halaman dibuka). Tautan ke Data Kreator baru dibuat
-- oleh Acquisition sendiri ("Buat/Tautkan Data Kreator" atau saat [Bound]).
-- Respons intake `linked_existing` kini berarti "username sudah terdaftar".
-- Kolom creator_prospects.existing_bound tidak lagi diisi intake (dibiarkan,
-- tanpa DROP). Idempoten.
-- =============================================================================

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
    -- Hanya penanda "sudah terdaftar" di Data Kreator — prospek TIDAK ditautkan
    -- dan TIDAK langsung [Bound]; Acquisition yang memutuskan (0375).
    v_linked := creator_prospect_match(v_user) is not null;

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
             phone_normalized = coalesce(phone_normalized, v_wa62)
       where id = v_pros.id;
      v_code := v_pros.code;
    else
      insert into creator_prospects (
        nama, tiktok_username, email, phone_raw, phone_normalized, followers_range, niche,
        kota, tiktok_go_status, binding_lain, usia_18, source, cta_id, attribution, wp_ref,
        status)
      values (
        v_nama, v_user, v_email, v_wa_raw, v_wa62,
        nullif(btrim(v_fields->>'followers_range'), ''), nullif(btrim(v_fields->>'niche'), ''),
        nullif(btrim(v_fields->>'kota'), ''), nullif(btrim(v_fields->>'tiktok_go_status'), ''),
        nullif(btrim(v_fields->>'binding_lain'), ''), (v_fields->>'usia_18')::boolean,
        'Website', v_cta, v_attr, v_wp_ref,
        '[Baru]')
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
  'Dipanggil HANYA oleh Edge Function meago-intake (service role). Idempoten per wp_ref. test:true → validasi saja. Kreator: selalu [Baru], tanpa tautan otomatis (0375).';

comment on column creator_prospects.existing_bound is
  'Tidak diisi lagi sejak 0375 (intake tidak lagi auto-Bound). Label "sudah terdaftar" dihitung aplikasi dari username.';

revoke execute on function meago_intake_apply(jsonb) from public, anon, authenticated;
grant execute on function meago_intake_apply(jsonb) to service_role;

-- Label "sudah terdaftar": prospek yang username-nya sudah ada di Data Kreator
-- (case-insensitive, tanpa "@"). Read-only, hanya untuk tim yang boleh melihat
-- prospek (sama dengan policy creator_prospects_select).
create or replace function creator_prospect_registered()
returns table (prospect_id uuid, mcn_creator_id uuid, creator_code text,
               creator_name text, binding_status text)
  language sql stable security definer set search_path = public as $$
  select p.id, c.id, c.code, c.name, c.binding_status
    from creator_prospects p
    join mcn_creators c
      on c.platform = 'tiktok' and lower(c.username) = p.tiktok_username
   where is_od() or is_director() or auth_division() in ('Acquisition','CreatorManagement')
$$;

comment on function creator_prospect_registered() is
  'Prospek yang username TikTok-nya sudah ada di mcn_creators — untuk label "sudah terdaftar" (0375). Tidak menautkan apa pun.';

revoke execute on function creator_prospect_registered() from public, anon;
grant execute on function creator_prospect_registered() to authenticated;
