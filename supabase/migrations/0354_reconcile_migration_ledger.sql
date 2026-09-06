-- =============================================================================
-- 0354 — Rekonsiliasi riwayat migrasi (T2). Catatan saja, TIDAK menyentuh skema.
-- =============================================================================
-- MASALAHNYA
--
-- `supabase_migrations.schema_migrations` di production memakai konvensi nama lama
-- (`phase0_0001_extensions`, `faseB_02_module1_leads`, `poi_sop_tracking`) sementara
-- repo memakai nomor urut (`0001_phase0_extensions`, `0101_module1_leads`,
-- `0336_poi_sop_tracking`). Akibatnya daftar nama migrasi TIDAK BISA dipakai untuk
-- menjawab "environment mana yang tertinggal" — pertanyaan yang justru membuat staging
-- kehilangan 12 migrasi tanpa terdeteksi (docs/SCHEMA_DRIFT.md, temuan 2026-09-04).
--
-- CARA PEMETAANNYA DIBUKTIKAN, BUKAN DITEBAK
--
-- Kolom `statements` menyimpan SQL yang benar-benar dijalankan. Setiap baris riwayat
-- di-hash sesudah dinormalisasi (komentar `--` + whitespace dibuang) lalu dicocokkan ke
-- hash file repo dengan normalisasi yang sama. **28 dari 36 rename di bawah cocok hash
-- persis** — bukti bahwa baris riwayat itu memang file repo tersebut, hanya beda nama.
--
-- Delapan sisanya (ditandai `nama` di komentar) namanya berpadanan jelas tapi hash-nya
-- beda karena FILE REPO-NYA DIEDIT SESUDAH DITERAPKAN. Itu temuan tersendiri, bukan
-- alasan menunda rename: skema hasil `db reset` sudah dibuktikan identik dengan
-- production (docs/STATUS_2026-09-05.md §8), jadi suntingan itu tidak mengubah keadaan
-- akhir — umumnya penambahan penjaga idempotensi.
--
-- YANG SENGAJA TIDAK DILAKUKAN
--
-- **Tidak ada baris yang dihapus.** Rencana T2 awalnya menyebut "bersihkan baris sampah
-- di staging", tapi baris-baris itu (`0317_acquisition_extra_fields`,
-- `0319_acquisition_followups`, `tmp_vgmv_*`, dst.) mencatat migrasi yang BENAR-BENAR
-- pernah jalan di staging. Objeknya memang sudah dibuang `0351`, dan justru baris
-- `0351` itulah yang mencatat pembuangannya. Menghapus riwayatnya menghilangkan bukti
-- apa yang pernah terjadi — riwayat adalah catatan "apa yang pernah jalan", bukan
-- "file apa yang ada sekarang". Sesudah migrasi ini kedua riwayat MASIH akan berbeda,
-- dan itu benar: staging punya sejarah eksperimen yang production tidak punya.
--
-- Baris yang tidak punya file repo sama sekali juga dibiarkan apa adanya, karena
-- semuanya catatan jujur: `phase0_0004b_status_transitions_rls`,
-- `phase0_0009_function_grants_fix`, `faseB_03_fix_status_enum_cast`,
-- `faseB_08_normalize_phone_searchpath`, `0310_poi_dealing`, `crm_leads_transaksi` (2x),
-- `crm_hardening_revoke_definer`, `0336_ops_name_add_fifas` (digantikan `0350`), dan
-- `0318_auth_users_token_null_guard` (diresmikan ulang oleh `0353`).
--
-- IDEMPOTEN & NO-OP DI DATABASE BERSIH
--
-- Rename dicocokkan ke nama LAMA yang persis; di hasil `db reset` nama-nama itu tidak
-- ada sama sekali, jadi seluruh blok ini no-op. Back-fill dijaga dua lapis: hanya bila
-- barisnya belum ada DAN objek yang dibuat migrasi itu benar-benar ada.
-- =============================================================================

-- ── 1. Samakan nama ke nama file repo ───────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- ✔ = hash isi cocok persis dengan file repo; `nama` = padanan nama, file repo
      --     sudah diedit sesudah diterapkan sehingga hash berbeda.
      ('phase0_0001_extensions',            '0001_phase0_extensions'),               -- ✔
      ('phase0_0002_core_roles',            '0002_phase0_core_roles'),               -- ✔
      ('phase0_0003_id_sequences',          '0003_phase0_id_sequences'),             -- ✔
      ('phase0_0004_status_machine',        '0004_phase0_status_machine'),           -- nama
      ('phase0_0005_audit_log',             '0005_phase0_audit_log'),                -- ✔
      ('phase0_0006_working_calendar',      '0006_phase0_working_calendar'),         -- ✔
      ('phase0_0007_okr',                   '0007_phase0_okr'),                      -- nama
      ('phase0_0008_hardening',             '0008_phase0_hardening'),                -- nama
      ('phase0_0010_employees_audit',       '0009_phase0_employees_audit'),          -- ✔
      ('faseB_01_module3_campaigns',        '0100_module3_campaigns'),               -- ✔
      ('faseB_02_module1_leads',            '0101_module1_leads'),                   -- nama
      ('faseB_04_module4_merchant',         '0102_module4_merchant'),                -- ✔
      ('faseB_05_module5_finance',          '0103_module5_finance'),                 -- ✔
      ('faseB_06_module2_marketing',        '0104_module2_marketing'),               -- ✔
      ('faseB_07_hardening',                '0105_faseB_hardening'),                 -- ✔
      ('faseC_01_module6_account',          '0200_module6_account'),                 -- ✔
      ('faseC_02_module7_ecommerce',        '0201_module7_ecommerce'),               -- ✔
      ('faseC_03_module8_ads',              '0202_module8_ads'),                     -- ✔
      ('faseC_04_module9_kol',              '0203_module9_kol'),                     -- ✔
      ('faseC_05_module10_livestream',      '0204_module10_livestream'),             -- ✔
      ('0316_mcn_creators_status_kontrak',  '0316_mcn_creator_status_kontrak'),      -- nama (prod ejaan "creators")
      ('brand_deals_poi_reconcile',         '0320_brand_deals_poi_reconcile'),       -- nama
      ('leads_bd_intake',                   '0330_leads_bd_intake'),                 -- ✔
      ('leads_crm_pipeline',                '0331_leads_crm_pipeline'),              -- ✔
      ('deal_transactions',                 '0332_deal_transactions'),               -- ✔
      ('deal_transaction_validate',         '0333_deal_transaction_validate'),       -- ✔
      ('brand_deals_delete_policy',         '0334_brand_deals_delete_policy'),       -- ✔
      ('prospect_attempts_delete_policy',   '0335_prospect_attempts_delete_policy'), -- ✔
      ('poi_sop_tracking',                  '0336_poi_sop_tracking'),                -- ✔
      ('poi_dining_sop_tracking',           '0337_poi_dining_sop_tracking'),         -- ✔
      ('lead_status_history',               '0338_lead_status_history'),             -- ✔
      ('schema_reconcile',                  '0339_schema_reconcile'),                -- nama
      ('portal_deals_filter',               '0340_portal_deals_filter'),             -- nama
      ('deals_edit_delete_director_only',   '0341_deals_edit_delete_director_only'), -- ✔
      ('poi_notes',                         '0342_poi_notes'),                       -- ✔
      ('poi_sla_settings',                  '0343_poi_sla_settings')                 -- ✔
    ) as m(nama_lama, nama_repo)
  loop
    update supabase_migrations.schema_migrations
       set name = r.nama_repo
     where name = r.nama_lama;
  end loop;
end $$;

-- ── 2. Back-fill dua baris yang hilang di production ────────────────────────
-- Objek kedua migrasi ini ADA di production (dibuktikan sidik jari penuh terhadap
-- database bersih hasil repo, docs/STATUS_2026-09-05.md §3) tapi riwayatnya tidak
-- pernah tercatat. Barisnya disisipkan hanya bila objek penandanya benar-benar ada,
-- jadi ini bukan riwayat karangan — ia mencatat sesuatu yang bisa diperiksa ulang.
-- Nomor versinya dipilih tepat sebelum tetangga kronologisnya supaya urutan riwayat
-- tetap masuk akal, dan `created_by` menandai bahwa baris ini hasil back-fill.
do $$
declare
  v_col_created_by boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'supabase_migrations'
       and table_name   = 'schema_migrations'
       and column_name  = 'created_by');
  r record;
begin
  for r in
    select * from (values
      ('20260718080703', '0312_creator_portal_f2',     'creator_reports'),
      ('20260723064224', '0315_weekly_retention_dedup', null)
    ) as m(versi, nama_repo, tabel_penanda)
  loop
    -- penanda kehadiran objek: 0312 membuat tabel creator_reports;
    -- 0315 menambah kolom upload_batches.file_hash_full.
    continue when exists (
      select 1 from supabase_migrations.schema_migrations where name = r.nama_repo);

    if r.tabel_penanda is not null then
      continue when to_regclass('public.' || r.tabel_penanda) is null;
    else
      continue when not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'upload_batches'
           and column_name = 'file_hash_full');
    end if;

    insert into supabase_migrations.schema_migrations (version, name)
    values (r.versi, r.nama_repo)
    on conflict (version) do nothing;

    if v_col_created_by then
      execute format(
        'update supabase_migrations.schema_migrations set created_by = %L where version = %L',
        '0354_reconcile_migration_ledger', r.versi);
    end if;
  end loop;
end $$;
