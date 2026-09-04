#!/usr/bin/env bash
# Uji rantai migrasi repo DARI NOL di PostgreSQL bersih.
#
# Kenapa ada: perubahan skema pernah di-apply langsung ke Supabase live tanpa file
# migrasi pendamping. Akibatnya `supabase db reset` / provisioning environment baru
# GAGAL — dan tidak ada yang tahu sampai ada yang mencoba. Skrip ini membuat
# kegagalan seperti itu ketahuan dalam hitungan detik.
#
# Pakai:  bash scripts/pg_test_reset.sh
# Keluar 0 bila seluruh migrasi lolos; 1 bila ada yang gagal (nama file + ERROR-nya
# dicetak). Butuh paket postgresql (psql + initdb) terpasang lokal.
#
# CATATAN: ini menguji BISA-TIDAKNYA rantai dijalankan, bukan kesetaraan dengan
# production. Untuk membandingkan hasil reset dengan skema live, lihat
# docs/SCHEMA_DRIFT.md.
set -uo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGPORT=${PGPORT:-55432}
PGDATA=${PGDATA:-/var/lib/postgresql/msdps_test}
DB=msdps_reset
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PGBIN:$PATH"

if ! command -v initdb >/dev/null; then
  echo "initdb tidak ditemukan di $PGBIN — pasang paket postgresql dulu." >&2
  exit 1
fi

# initdb wajib dijalankan sebagai user non-root; jalur PGDATA harus bisa ditembus
# user tersebut (jangan taruh di bawah direktori scratch ber-permission ketat).
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id -u postgres >/dev/null 2>&1 || useradd -m postgres
  mkdir -p "$(dirname "$PGDATA")" && chown postgres "$(dirname "$PGDATA")"
  RUNAS="postgres"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else bash -c "$1"; fi; }

[ -d "$PGDATA/base" ] || run "initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
run "pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l /tmp/pg_msdps.log start" >/dev/null 2>&1
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -tAc 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done
psql -h /tmp -p "$PGPORT" -U postgres -tAc 'select 1' >/dev/null 2>&1 || {
  echo "Postgres gagal start. Log:"; tail -20 /tmp/pg_msdps.log; exit 1; }

# Stub minimal lingkungan Supabase — migrasi memakai auth.uid(), role anon/authenticated,
# pg_cron, dan storage.buckets yang tidak ada di Postgres polos.
STUB=$(mktemp)
cat > "$STUB" <<'SQL'
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
grant usage on schema auth to public;
create schema if not exists cron;
-- cron.job dicatat sungguhan (bukan stub yang membuang argumennya) supaya sidik
-- jari scripts/schema_fingerprint.sql bisa membandingkan jadwal job antara hasil
-- reset dan live — job yang hilang di satu sisi jadi kelihatan.
create table if not exists cron.job (
  jobid bigserial primary key, schedule text, command text, jobname text unique);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create or replace function cron.unschedule(p_name text) returns boolean language sql as $$
  delete from cron.job where jobname = p_name returning true $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), metadata jsonb);
-- Riwayat migrasi: diisi loop di bawah dengan nama file yang berhasil diterapkan,
-- meniru supabase_migrations.schema_migrations di Supabase. Dipakai
-- scripts/schema_fingerprint.sql untuk menjawab "migrasi mana yang belum masuk
-- ke environment X" — pertanyaan yang tidak terjawab sebelum ada ini, dan yang
-- membuat staging kehilangan 12 migrasi tanpa terdeteksi.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, name text);
SQL

psql -h /tmp -p "$PGPORT" -U postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$STUB" || { rm -f "$STUB"; exit 1; }
rm -f "$STUB"

n=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  out=$(psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)
  if [ $? -ne 0 ]; then
    echo "❌ GAGAL di $(basename "$f")"
    echo "$out" | grep -E "ERROR|FATAL" | head -5
    exit 1
  fi
  base=$(basename "$f" .sql)
  psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -c \
    "insert into supabase_migrations.schema_migrations (version, name)
     values ('$base', '$base') on conflict (version) do nothing;" >/dev/null
  n=$((n + 1))
done
echo "✅ $n migrasi lolos dari nol (database $DB, port $PGPORT)"
