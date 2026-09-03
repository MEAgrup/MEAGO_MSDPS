-- =============================================================================
-- MSDPS · Migration 0339 — Rekonsiliasi sisa drift repo ↔ live
-- =============================================================================
-- Lanjutan 0320. Setelah 0320 memperbaiki kolom POI `brand_deals` dan membuat
-- rantai migrasi bisa jalan dari nol lagi, hasil `supabase db reset` dibandingkan
-- kolom-per-kolom dengan live `mvcckptntrvzujqaoxxh` (2026-09-02). Tersisa dua
-- selisih yang diperbaiki di sini, dan dua yang SENGAJA tidak (lihat bawah).
--
-- Cara mengulang perbandingannya: `bash scripts/pg_test_reset.sh` lalu ikuti
-- docs/SCHEMA_DRIFT.md.
--
-- IDEMPOTEN & AMAN UNTUK LIVE: di database yang sudah punya semuanya, file ini
-- NO-OP. Tidak menyentuh data.
-- =============================================================================

-- ---- (1) mcn_creators.status_kontrak: NOT NULL DEFAULT 'kontrak' ------------
-- Live sudah ketat; repo (0316) membuatnya nullable tanpa default. Tanpa ini,
-- environment hasil reset menerima kreator tanpa status kontrak — padahal
-- segmentasi kelayakan campaign (Fase G) memakai kolom ini sebagai filter.
-- Backfill dulu supaya SET NOT NULL tidak gagal di database yang sudah berisi.
alter table mcn_creators alter column status_kontrak set default 'kontrak';
update mcn_creators set status_kontrak = 'kontrak' where status_kontrak is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mcn_creators'
      and column_name = 'status_kontrak' and is_nullable = 'YES'
  ) then
    alter table mcn_creators alter column status_kontrak set not null;
  end if;
end $$;

comment on column mcn_creators.status_kontrak is
  'Kontrak / non kontrak. NOT NULL default ''kontrak''. Dipakai sebagai filter segmentasi kelayakan campaign kreator.';

-- ---- (2) v_poi_deal_summary: rekap skor BD per periode ----------------------
-- Ada di live, tidak pernah ada di repo. Dipertahankan (bukan dibuang) karena
-- inilah rekap yang seharusnya menjawab "BD mana menghasilkan berapa poin" —
-- lihat catatan B2/B3 di bawah.
--
-- ⚠ PENTING — view ini menghasilkan NOL selama kolom sumbernya tidak pernah diisi:
--   · `realisasi_visit` = count(*) filter (where visit_checked)  → live: 0 baris terisi
--   · `poin_sum`        = sum(poin), dan `poin` diturunkan trigger dari
--     `visit_checked` + `kreator_realized`/`kreator_needed` (0333)
-- Per audit 2026-09-02, tidak ada satu pun baris kode di `app/` maupun `lib/` yang
-- menulis `visit_checked` / `kreator_realized` / `video_realized`, sementara yang
-- benar-benar diisi tim adalah `poi_sop_progress.actual_vt` + `total_gmv` (form di
-- `app/(app)/bizdev/poi/poi-card.tsx`). Jadi ada DUA model realisasi, dan formula
-- poin membaca yang mati. Menyatukannya adalah perubahan perilaku — dikerjakan
-- terpisah, bukan diselundupkan ke migrasi rekonsiliasi ini.
create or replace view v_poi_deal_summary as
  select
    to_char(d.created_at, 'YYYYMM')                              as period,
    d.bd_id,
    coalesce(e.full_name, '(tanpa BD)')                          as bd_name,
    d.kategori_poi,
    count(*)::integer                                            as total_deal,
    count(*) filter (where d.visit_checked)::integer             as realisasi_visit,
    coalesce(sum(d.poin), 0::numeric)                            as poin_sum
  from brand_deals d
  left join employees e on e.id = d.bd_id
  where d.kategori_poi is not null
  group by 1, 2, 3, 4;

comment on view v_poi_deal_summary is
  'Rekap deal & skor BD per periode/BD/kategori POI. Hanya baris ber-kategori_poi (baris Import Master Deal yang belum dilengkapi tidak dihitung).';

-- =============================================================================
-- SENGAJA TIDAK DIREKONSILIASI (butuh keputusan, bukan keputusan teknis)
-- =============================================================================
-- `crm_leads` dan `crm_transaksi` ada di live, tidak ada di repo, **0 baris**, dan
-- tidak direferensikan satu kali pun di `app/` maupun `lib/` (modul Leads yang
-- dipakai adalah `leads` M1 dari 0101/0330/0331). Kemungkinan besar sisa eksperimen.
--
-- Tidak dibuat ulang di repo (mengabadikan tabel mati), dan TIDAK di-drop dari live
-- di sini — menghapus objek produksi adalah tindakan yang tidak bisa dibatalkan dan
-- harus diminta eksplisit. Selama keduanya masih ada, hasil `db reset` setara live
-- KECUALI dua tabel kosong ini.
--
-- Bila sudah dipastikan tidak terpakai, drop-nya cukup:
--     drop table if exists crm_transaksi;
--     drop table if exists crm_leads;
-- =============================================================================
