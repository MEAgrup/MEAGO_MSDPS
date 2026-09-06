#!/usr/bin/env bash
# ⚠ SUDAH DIJALANKAN 2026-09-03 — production kini memuat seluruh roster staging
#   (2.250 baris; 2.248 roster bersih staging semuanya ada). JANGAN jalankan lagi
#   kecuali scripts/creator_roster_fingerprint.sql menunjukkan ada yang hilang.
#   Skrip ini idempoten (ON CONFLICT DO NOTHING, tidak menimpa apa pun), tapi tiap
#   kali jalan ia tetap membakar nomor id_sequences untuk baris yang di-skip.
#   Rincian & bukti paritas: docs/HANDOFF_LANJUTAN.md item 1.
# Pindahkan master kreator MEA GO dari STAGING ke PRODUCTION.
#
# LATAR (audit 2026-09-02): roster kreator asli ter-impor ke STAGING, bukan production.
#   production mcn_creators : 34 baris   (data era QA, termasuk 2 baris uji)
#   staging    mcn_creators : 3.505 baris (roster asli, 22-27 Juli 2026)
# Padahal seluruh data operasional lain (608 lead, 79 deal, tracker POI) ada di
# PRODUCTION dan staging kosong. Jadi hanya tabel ini yang perlu dipindahkan.
#
# ⚠ Roster staging TIDAK bersih. Skrip ini membersihkannya lebih dulu:
#   · 1.296 username diawali '@' (impor kedua tidak memotong '@'); 1.248 di antaranya
#     duplikat dari versi bersihnya  -> username dinormalisasi lalu di-dedupe
#   · 11 baris uji (nama mengandung test/dummy/qa/coba, atau username kosong) -> dibuang
#   · Hasil bersih: ~2.248 kreator unik
#
# Kolom yang dipindah HANYA name, username, platform, status — sisanya memang kosong
# di staging (niche 5, city 0, level 0, gmv 0, owner_cpm 0, auth_user_id 0).
# `code` SENGAJA tidak dibawa: dibiarkan di-mint trigger production (next_code_global)
# supaya id_sequences ikut maju dan tidak bentrok di kemudian hari.
#
# Kreator yang sudah ada di production (cocok per lower(username)) DILEWATI —
# ON CONFLICT DO NOTHING pada unique index (platform, lower(username)).
#
# CARA PAKAI
#   Ambil connection string (mode "Session"/direct, bukan pooler transaksi) dari
#   Supabase Dashboard > Project Settings > Database > Connection string > URI.
#
#     export STAGING_URL='postgresql://postgres:PASSWORD@db.vgjzvdpxrdoefoncuazw.supabase.co:5432/postgres'
#     export PROD_URL='postgresql://postgres:PASSWORD@db.mvcckptntrvzujqaoxxh.supabase.co:5432/postgres'
#     bash scripts/migrate_creators_staging_to_prod.sh --dry-run   # lihat hitungannya dulu
#     bash scripts/migrate_creators_staging_to_prod.sh             # jalankan
#
# Data mengalir langsung staging -> production lewat pipe COPY; tidak ada nama kreator
# yang melewati clipboard, chat, atau file perantara.
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

: "${STAGING_URL:?set STAGING_URL dulu (lihat komentar di atas)}"
: "${PROD_URL:?set PROD_URL dulu (lihat komentar di atas)}"

# Satu definisi "roster bersih", dipakai dry-run maupun eksekusi.
CLEAN_SQL="
with base as (
  select name, status, created_at,
         lower(ltrim(btrim(username), '@')) as u
  from mcn_creators
  where username is not null
    and lower(name) !~ '(test|dummy|qa|coba)'
    and btrim(ltrim(btrim(username), '@')) <> ''
)
select distinct on (u) name, u, status
from base order by u, created_at
"

echo '== STAGING: ringkasan roster =='
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -c "
select (select count(*) from mcn_creators) as baris_mentah,
       (select count(*) from ($CLEAN_SQL) t) as siap_dipindah;"

echo
echo '== PRODUCTION: keadaan sekarang =='
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c 'select count(*) as kreator_sekarang from mcn_creators;'

if [ "$DRY_RUN" = "1" ]; then
  echo; echo 'DRY RUN — tidak ada yang ditulis. Jalankan tanpa --dry-run untuk eksekusi.'
  exit 0
fi

echo
echo '== Menyalin staging -> production =='
# Staging area di production supaya insert-nya satu transaksi & bisa dihitung.
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c '
create temp table _incoming (name text, username text, status text);' >/dev/null 2>&1 || true

# Pipe langsung: COPY OUT dari staging -> COPY IN ke production, dalam satu sesi psql
# production supaya temp table-nya hidup.
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -c "\\copy ($CLEAN_SQL) to stdout with (format csv)" \
| psql "$PROD_URL" -v ON_ERROR_STOP=1 --single-transaction -c '
create temp table _incoming (name text, username text, status text);
\copy _incoming from stdin with (format csv)
insert into mcn_creators (name, username, platform, status, status_kontrak)
select i.name, i.username, '"'"'tiktok'"'"', i.status, '"'"'kontrak'"'"'
from _incoming i
on conflict (platform, lower(username)) where username is not null do nothing;
'

echo
echo '== Hasil =='
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c "
select count(*) as kreator_total,
       count(*) filter (where created_at::date = current_date) as masuk_hari_ini
from mcn_creators;"
