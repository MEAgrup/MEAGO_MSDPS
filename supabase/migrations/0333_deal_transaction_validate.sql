-- =============================================================================
-- MSDPS · Leads/BD · Migration 0333 — brand_deals_validate: selaraskan dgn 0332
-- =============================================================================
-- brand_deals_validate() (SECURITY DEFINER) sudah menegakkan blok "POI" (aktif
-- bila kategori_poi terisi) dari pekerjaan sebelumnya yang tidak tercermin di
-- riwayat migrasi lokal. Diselaraskan di sini dengan spesifikasi saat ini:
--   - konten_needed dibuat OPSIONAL (spesifikasi saat ini tidak mewajibkannya,
--     beda dari kreator_needed yang wajib > 0).
--   - lead_id, bd_id, ops_name ditambahkan sebagai wajib begitu kategori_poi
--     terisi (kolom baru 0332).
--   - tanggal_mulai_kontrak & tanggal_akhir_kontrak wajib khusus kategori
--     'Dining'.
--   - Opsi "Benefit Diberikan" yang diketik manual disimpan otomatis ke
--     lead_benefit_options (dipakai bersama dengan Leads & Prospek) — pola
--     sama dengan leads_validate().
-- kategori_poi kosong (baris hasil Import Master Deal yang belum dilengkapi)
-- tetap melewati seluruh blok ini — dipakai UI sebagai penanda "belum lengkap".
-- =============================================================================

create or replace function brand_deals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rule     jsonb;
  v_full_pct numeric;
  v_full     numeric;
  v_half_pct numeric;
  v_half     numeric;
  v_low      numeric;
  v_pct      numeric;
  v_digits   text;
begin
  -- --- Perilaku existing (semua baris) ---
  if new.brand_name is null or btrim(new.brand_name) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  -- deal_end mengikuti exp_date (single source of truth).
  new.deal_end := new.exp_date;
  if new.code is null then
    new.code := next_code('DEAL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- --- Blok POI (hanya bila kategori_poi terisi) ---
  if new.kategori_poi is not null then
    -- Pertanyaan wajib POI. konten_needed sengaja TIDAK wajib (beda dari
    -- kreator_needed) sesuai spesifikasi form "Daftarkan Transaksi".
    if new.pic_name is null or btrim(new.pic_name) = ''
       or new.pic_whatsapp is null or btrim(new.pic_whatsapp) = ''
       or new.bentuk_kerjasama is null
       or new.benefit is null or btrim(new.benefit) = ''
       or new.visit_start_date is null
       or new.visit_end_date is null
       or new.kreator_needed is null or new.kreator_needed <= 0
       or new.lead_id is null
       or new.bd_id is null
       or new.ops_name is null then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    if new.kategori_poi = 'Dining'
       and (new.tanggal_mulai_kontrak is null or new.tanggal_akhir_kontrak is null) then
      raise exception '[tanggal awal & akhir kerjasama wajib diisi untuk kategori Dining]'
        using errcode = 'check_violation';
    end if;

    -- Berbayar wajib nominal_harga > 0.
    if new.bentuk_kerjasama = 'Berbayar'
       and (new.nominal_harga is null or new.nominal_harga <= 0) then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    -- Rentang tanggal visit.
    if new.visit_end_date < new.visit_start_date then
      raise exception '[tanggal selesai visit tidak boleh sebelum tanggal mulai]'
        using errcode = 'check_violation';
    end if;

    -- Normalisasi nomor WA PIC: digits only, 0… -> 62…, biarkan 62….
    v_digits := regexp_replace(new.pic_whatsapp, '[^0-9]', '', 'g');
    if v_digits like '0%' then
      v_digits := '62' || substr(v_digits, 2);
    end if;
    new.pic_whatsapp := v_digits;

    -- Opsi benefit baru yang diketik manual tersimpan untuk semua user
    -- berikutnya (dipakai bersama dropdown "Benefit Dealing" di Leads & Prospek).
    insert into lead_benefit_options (label) values (new.benefit)
      on conflict (label) do nothing;

    -- POIN DERIVED: selalu dihitung ulang (abaikan nilai kiriman klien).
    select value into v_rule from app_config where key = 'poi.poin_rule';
    v_full_pct := coalesce((v_rule->>'full_pct')::numeric, 100);
    v_full     := coalesce((v_rule->>'full')::numeric,     2);
    v_half_pct := coalesce((v_rule->>'half_pct')::numeric, 50);
    v_half     := coalesce((v_rule->>'half')::numeric,     1);
    v_low      := coalesce((v_rule->>'low')::numeric,      0.5);

    if new.visit_checked is true then
      if new.kreator_realized is null
         or new.kreator_needed is null or new.kreator_needed = 0 then
        new.poin := v_half;
      else
        v_pct := new.kreator_realized::numeric / nullif(new.kreator_needed, 0) * 100;
        if v_pct >= v_full_pct then
          new.poin := v_full;
        elsif v_pct >= v_half_pct then
          new.poin := v_half;
        else
          new.poin := v_low;
        end if;
      end if;
    else
      new.poin := 0;
    end if;
  end if;

  return new;
end $$;

revoke execute on function brand_deals_validate() from public, anon, authenticated;
