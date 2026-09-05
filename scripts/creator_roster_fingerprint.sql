-- =============================================================================
-- Sidik jari roster kreator — bandingkan mcn_creators antar dua database
-- =============================================================================
-- Kenapa ada: `scripts/migrate_creators_staging_to_prod.sh` memindahkan roster
-- lewat pipe COPY supaya nama kreator tidak melewati chat/clipboard. Efek
-- sampingnya, tidak ada jejak yang bisa dibaca ulang: sesudah skrip jalan, satu-
-- satunya cara tahu "sudah sinkron belum" adalah menjalankan skripnya lagi.
--
-- Itu betul-betul menggigit: handoff 2026-09-04 mencatat skrip ini "belum pernah
-- dijalankan" dan production "cuma punya 34 kreator", padahal roster sudah masuk
-- 2026-09-03 (2.216 baris). Diagnosis salah karena tidak ada alat untuk
-- memeriksanya. File ini menutup celah itu.
--
-- Caranya: bandingkan HASH per bucket, bukan daftar nama. Satu baris keluaran
-- mewakili ~140 kreator, jadi seluruh roster 2.248 muat dalam 16 baris dan tidak
-- ada satu pun username yang ikut terbaca.
--
-- Normalisasi & filter di sini WAJIB sama persis dengan CLEAN_SQL di
-- `scripts/migrate_creators_staging_to_prod.sh` — kalau salah satu diubah, ubah
-- keduanya, kalau tidak perbandingannya jadi bohong.
--
-- Cara pakai — jalankan di KEDUA database, simpan keluarannya, lalu diff:
--
--   psql "$STAGING_URL" -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
--     | LC_ALL=C sort > /tmp/roster_staging.txt
--   psql "$PROD_URL"    -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
--     | LC_ALL=C sort > /tmp/roster_prod.txt
--   LC_ALL=C diff /tmp/roster_staging.txt /tmp/roster_prod.txt
--
--   # tanpa psql: tempel isi file ini ke MCP Supabase execute_sql di kedua
--   # project, simpan hasilnya, diff manual.
--
-- Membaca hasilnya:
--   bucket|<hex>|<n>|<hash>  → n & hash SAMA di kedua sisi = bucket itu identik.
--                              Beda n = ada baris ekstra di satu sisi.
--                              n sama tapi hash beda = username-nya berbeda.
--   Untuk melacak baris ekstranya, ulangi dengan substr(md5(u),1,2) pada bucket
--   yang berbeda saja — mempersempit ke ~9 baris tanpa membuka seluruh roster.
--
--   siap|...   → ringkasan kesiapan segmentasi campaign Fase G. Roster yang
--                lengkap namanya tapi kolom segmentasinya kosong TETAP membuat
--                fitur kelayakan tidak berguna: lihat
--                creator_meets_campaign_eligibility() di migrasi 0343 — filter
--                eligible_industries/cities/levels/creator_types membandingkan
--                langsung ke niche/city/creator_level/jenis_creator. Kolom kosong
--                = 0 kreator lolos, kecuali kolom eligible_* dibiarkan NULL.
-- =============================================================================

with base as (
  -- Definisi "roster bersih" — cermin CLEAN_SQL di migrate_creators_staging_to_prod.sh
  select distinct lower(ltrim(btrim(username), '@')) as u
  from mcn_creators
  where username is not null
    and lower(name) !~ '(test|dummy|qa|coba)'
    and btrim(ltrim(btrim(username), '@')) <> ''
)
select 'bucket' as kind,
       substr(md5(u), 1, 1) as name,
       count(*)::text as n,
       md5(string_agg(u, ',' order by u)) as hash
from base
group by 2

union all
select 'total', 'roster_bersih', count(*)::text, md5(string_agg(u, ',' order by u))
from base

union all
-- Kesiapan segmentasi: nama saja tidak cukup untuk fitur kelayakan Fase G.
select 'siap', k, v::text, ''
from (
  select count(*)                                            as baris_mentah,
         count(niche)                                        as niche_terisi,
         count(city)                                         as city_terisi,
         count(creator_level)                                as level_terisi,
         count(jenis_creator)                                as jenis_terisi,
         count(*) filter (where live_roster)                 as live_roster_true,
         count(auth_user_id)                                 as akun_portal,
         count(distinct status_kontrak)                      as ragam_status_kontrak,
         count(*) filter (where code is null)                as tanpa_code
  from mcn_creators
) s, lateral (values
  ('baris_mentah', s.baris_mentah), ('niche_terisi', s.niche_terisi),
  ('city_terisi', s.city_terisi),   ('level_terisi', s.level_terisi),
  ('jenis_terisi', s.jenis_terisi), ('live_roster_true', s.live_roster_true),
  ('akun_portal', s.akun_portal),   ('ragam_status_kontrak', s.ragam_status_kontrak),
  ('tanpa_code', s.tanpa_code)
) as t(k, v)

order by 1, 2;
