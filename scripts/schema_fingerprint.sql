-- =============================================================================
-- Sidik jari skema — satu kueri, dipakai untuk MEMBANDINGKAN dua database
-- =============================================================================
-- Kenapa ada: `scripts/pg_test_reset.sh` hanya menguji rantai migrasi BISA jalan
-- dari nol. Ia tidak tahu apa-apa soal apakah staging setara production. Celah
-- itu membuat staging kehilangan 12 migrasi tanpa ada yang sadar sampai ada yang
-- mencoba apply migrasi baru ke sana (lihat docs/SCHEMA_DRIFT.md, temuan
-- 2026-09-04). Prosedur perbandingan sebelumnya di dokumen itu juga hanya
-- melihat KOLOM — constraint, RLS policy, fungsi, trigger, dan bucket Storage
-- bisa menyimpang tanpa terdeteksi.
--
-- Cakupan: kolom, constraint, index, RLS policy, fungsi, trigger, view, enum,
-- bucket Storage, job pg_cron, dan daftar riwayat migrasi.
--
-- Cara pakai — jalankan file ini di KEDUA database, simpan keluarannya, lalu diff:
--
--   # lewat psql (mis. hasil scripts/pg_test_reset.sh)
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -tAqF'|' \
--     -f scripts/schema_fingerprint.sql | LC_ALL=C sort > /tmp/fp_local.txt
--
--   # lewat MCP Supabase execute_sql (staging / production), simpan hasilnya
--   # sebagai baris "kind|name|hash" ke /tmp/fp_staging.txt & /tmp/fp_prod.txt
--
--   LC_ALL=C diff /tmp/fp_staging.txt /tmp/fp_prod.txt
--
-- Baris yang HANYA muncul di satu sisi = objek hilang/kelebihan.
-- Baris dengan nama sama tapi hash beda = definisinya menyimpang.
--
-- JANGAN meringkas keluaran ini jadi satu hash agregat di dalam SQL
-- (`md5(string_agg(... order by name))`). Urutan `order by` mengikuti collation
-- database, dan hasil `pg_test_reset.sh` biasanya `C.UTF-8` sementara Supabase
-- `en_US.UTF-8` — isi yang IDENTIK bisa menghasilkan hash agregat berbeda. Kejadian
-- nyata 2026-09-05: jalan pintas agregat melaporkan fungsi "berbeda" antara reset
-- repo dan production padahal ke-103 definisinya sama persis. Keluarkan satu baris
-- per objek seperti di bawah, urutkan dengan `LC_ALL=C sort` DI LUAR database,
-- lalu diff.
--
-- Catatan: `schema_migrations` sengaja ikut dilaporkan sebagai satu baris per
-- nama migrasi, TANPA timestamp — timestamp memang selalu beda antar environment;
-- yang penting adalah migrasi mana yang tercatat pernah diterapkan.
-- =============================================================================

with fp as (
  -- kolom (nama, tipe, nullability, default)
  select 'column' as kind, c.table_name as name,
         md5(string_agg(c.column_name||':'||c.data_type||':'||c.is_nullable||':'||
                        coalesce(c.column_default,'-'), ',' order by c.column_name)) as hash
    from information_schema.columns c
   where c.table_schema = 'public'
   group by c.table_name

  union all
  -- constraint (pk/fk/unique/check) per tabel
  select 'constraint', c.relname,
         md5(string_agg(con.conname||'='||pg_get_constraintdef(con.oid), '|' order by con.conname))
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
   group by c.relname

  union all
  -- index (termasuk partial unique index yang tidak berupa constraint)
  select 'index', tablename,
         md5(string_agg(indexname||'='||indexdef, '|' order by indexname))
    from pg_indexes where schemaname = 'public' group by tablename

  union all
  -- RLS policy: nama, perintah, role, USING, WITH CHECK
  select 'policy', tablename,
         md5(string_agg(policyname||'/'||cmd||'/'||array_to_string(roles,',')||
                        '/'||coalesce(qual,'-')||'/'||coalesce(with_check,'-'),
                        '|' order by policyname))
    from pg_policies where schemaname = 'public' group by tablename

  union all
  -- RLS aktif atau tidak
  select 'rls_enabled', c.relname, c.relrowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'

  union all
  -- fungsi: badan + security definer + search_path
  select 'function', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
         md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'

  union all
  -- trigger
  select 'trigger', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal

  union all
  -- view (definisi + security_invoker)
  select 'view', c.relname,
         md5(pg_get_viewdef(c.oid) || coalesce(array_to_string(c.reloptions, ','), '-'))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'

  union all
  -- enum: label + urutannya
  select 'enum', t.typname,
         md5(string_agg(e.enumlabel, ',' order by e.enumsortorder))
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   group by t.typname

  union all
  -- bucket Storage (privat/publik)
  select 'storage_bucket', id, public::text from storage.buckets

  union all
  -- job pg_cron (jadwal + perintah)
  select 'cron_job', jobname, md5(schedule||'|'||command) from cron.job

  union all
  -- riwayat migrasi (nama saja, timestamp diabaikan)
  select 'migration', name, '' from supabase_migrations.schema_migrations
)
select kind || '|' || name || '|' || hash as fingerprint
  from fp
 order by kind, name;
