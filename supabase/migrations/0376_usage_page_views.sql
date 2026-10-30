-- =============================================================================
-- 0376 — Log pemakaian sistem per karyawan (halaman Aktivitas)
-- =============================================================================
-- Feedback Tim OD 26-10-2026 (disetujui Yohan 28-10-2026): OD ingin melihat per
-- karyawan berapa jam memakai MSDPS, berapa sesi, berapa halaman dibuka, dan
-- kapan terakhir aktif — setara /admin/adopsi di CDPS & "Adopsi Sistem" di MCN.
--
-- Ini INDIKATOR ADAPTASI, BUKAN komponen reward: RPC di bawah tidak menghitung
-- peringkat, skor, atau ambang apa pun.
--
-- Sebelum migrasi ini MSDPS tidak punya telemetri pemakaian sama sekali
-- (audit_log 0005 hanya mencatat perubahan data). Data sebelum deploy TIDAK ADA
-- dan tidak bisa dibuat surut — UI menampilkan "Tercatat sejak <tanggal>" dari
-- usage_recorded_since().
--
-- Desain (pola sama dengan CDPS page_views, kode tidak disalin lintas repo):
--   * usage_page_views append-only: trigger menolak UPDATE/DELETE. Satu-satunya
--     jalur hapus = usage_purge_expired() (retensi 12 bulan, pg_cron bulanan).
--   * Karyawan hanya boleh INSERT barisnya sendiri dan hanya bila aktif. Tidak
--     ada SELECT langsung untuk anon/authenticated — baca hanya lewat RPC.
--   * usage_summary() mengagregasi di server (supabase-js memotong hasil di
--     ±1000 baris; baris mentah tidak pernah dikirim ke klien). Sesi putus bila
--     jeda > 30 menit (sama dengan CDPS). Gerbang wewenang di DALAM RPC:
--     OD/Director semua divisi, Lead/SPV divisinya sendiri, staff ditolak.
-- =============================================================================

create table if not exists usage_page_views (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references employees(id),
  path         text not null check (left(path, 1) = '/' and length(path) <= 512),
  occurred_at  timestamptz not null default now()
);

comment on table usage_page_views is
  'Append-only: satu baris per halaman MSDPS yang dibuka karyawan. Indikator adaptasi, bukan komponen reward. Retensi 12 bulan (usage_purge_expired).';

create index if not exists usage_page_views_employee_time_idx
  on usage_page_views (employee_id, occurred_at);
create index if not exists usage_page_views_time_idx
  on usage_page_views (occurred_at);

-- ---- Append-only ------------------------------------------------------------
-- Flag transaksi-lokal `msdps.usage_purge` hanya dipasang oleh
-- usage_purge_expired(); authenticated tidak punya hak DELETE/UPDATE sama
-- sekali, jadi flag ini bukan celah bagi klien.
create or replace function usage_page_views_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('msdps.usage_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'usage_page_views bersifat append-only (% ditolak)', tg_op
    using errcode = '42501';
end $$;

drop trigger if exists usage_page_views_append_only on usage_page_views;
create trigger usage_page_views_append_only
  before update or delete on usage_page_views
  for each row execute function usage_page_views_append_only();

drop trigger if exists usage_page_views_no_truncate on usage_page_views;
create trigger usage_page_views_no_truncate
  before truncate on usage_page_views
  for each statement execute function usage_page_views_append_only();

-- ---- RLS ----------------------------------------------------------------------
alter table usage_page_views enable row level security;

revoke all on table usage_page_views from public, anon, authenticated;
grant insert (employee_id, path) on table usage_page_views to authenticated;

drop policy if exists usage_page_views_insert_own on usage_page_views;
create policy usage_page_views_insert_own on usage_page_views
  for insert to authenticated
  with check (
    employee_id = auth.uid()
    and exists (select 1 from employees e where e.id = auth.uid() and e.active)
  );
-- Sengaja TIDAK ada policy SELECT/UPDATE/DELETE.

-- ---- Agregasi ---------------------------------------------------------------
-- p_grain: 'month' (default) atau 'week' (minggu ISO, Senin). Periode & sesi
-- dihitung dalam zona WIB. Sesi dibuka oleh page view pertama atau page view
-- sesudah jeda > 30 menit; durasinya = page view terakhir − pertama di sesi itu
-- (sesi satu halaman = 0 menit, sama dengan CDPS). Sesi dimasukkan ke periode
-- tempat ia dimulai.
--
-- Karyawan AKTIF dalam cakupan tetap muncul dengan angka 0 pada periode tanpa
-- aktivitas — yang belum memakai sistem justru yang paling perlu terlihat OD.
create or replace function usage_summary(
  p_from     timestamptz,
  p_to       timestamptz,
  p_division text default null,
  p_grain    text default 'month'
) returns table (
  period_start date,
  employee_id  uuid,
  full_name    text,
  division     text,
  hours        numeric,
  sessions     integer,
  page_views   integer,
  last_active  timestamptz
)
  language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  me   employees%rowtype;
  scope_div text;
  unit text;
begin
  select * into me from employees where id = auth.uid() and active;
  if not found then
    raise exception 'Hanya karyawan aktif yang dapat melihat aktivitas' using errcode = '42501';
  end if;

  if me.is_od or me.is_director then
    scope_div := nullif(p_division, '');
  elsif me.rank = 'lead' then
    scope_div := me.division::text;   -- Lead/SPV: divisinya sendiri, p_division diabaikan
  else
    raise exception 'Aktivitas karyawan hanya untuk OD, Director, dan Lead/SPV' using errcode = '42501';
  end if;

  if p_grain not in ('month', 'week') then
    raise exception 'p_grain harus month atau week' using errcode = '22023';
  end if;
  unit := p_grain;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Rentang waktu tidak valid' using errcode = '22023';
  end if;

  return query
  with scoped as (
    select e.id, e.full_name, e.division::text as division, e.active
      from employees e
     where scope_div is null or e.division::text = scope_div
  ),
  pv as (
    select v.employee_id, v.occurred_at,
           v.occurred_at - lag(v.occurred_at) over w as gap
      from usage_page_views v
     where v.occurred_at >= p_from and v.occurred_at < p_to
       and v.employee_id in (select id from scoped)
    window w as (partition by v.employee_id order by v.occurred_at)
  ),
  marked as (
    select pv.*,
           sum(case when gap is null or gap > interval '30 minutes' then 1 else 0 end)
             over (partition by pv.employee_id order by pv.occurred_at
                   rows between unbounded preceding and current row) as session_no
      from pv
  ),
  sess as (
    select m.employee_id,
           min(m.occurred_at) as s_start,
           max(m.occurred_at) as s_end,
           count(*)           as n_pv
      from marked m
     group by m.employee_id, m.session_no
  ),
  agg as (
    select s.employee_id,
           date_trunc(unit, s.s_start at time zone 'Asia/Jakarta')::date as p_start,
           sum(extract(epoch from s.s_end - s.s_start))                  as secs,
           count(*)                                                      as n_sess,
           sum(s.n_pv)                                                   as n_pv,
           max(s.s_end)                                                  as last_at
      from sess s
     group by 1, 2
  ),
  periods as (
    select g::date as p_start
      from generate_series(
             date_trunc(unit, p_from at time zone 'Asia/Jakarta'),
             date_trunc(unit, (p_to - interval '1 microsecond') at time zone 'Asia/Jakarta'),
             ('1 ' || unit)::interval) g
  ),
  grid as (
    -- karyawan aktif × semua periode, ditambah pasangan yang memang punya data
    -- (karyawan nonaktif hanya muncul pada periode ia tercatat).
    select sc.id, p.p_start from scoped sc cross join periods p where sc.active
    union
    select a.employee_id, a.p_start from agg a
  )
  select g.p_start,
         sc.id,
         sc.full_name,
         sc.division,
         round(coalesce(a.secs, 0) / 3600.0, 2),
         coalesce(a.n_sess, 0)::integer,
         coalesce(a.n_pv, 0)::integer,
         a.last_at
    from grid g
    join scoped sc on sc.id = g.id
    left join agg a on a.employee_id = g.id and a.p_start = g.p_start
   order by g.p_start desc, sc.full_name;
end $$;

-- Kapan pencatatan dimulai (data sebelum deploy tidak ada). Sesudah retensi
-- berjalan, nilainya ikut maju = data tertua yang masih tersedia.
create or replace function usage_recorded_since() returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(occurred_at) from usage_page_views
   where exists (select 1 from employees e where e.id = auth.uid() and e.active
                   and (e.is_od or e.is_director or e.rank = 'lead'))
$$;

revoke execute on function usage_summary(timestamptz, timestamptz, text, text),
  usage_recorded_since() from public, anon;
grant execute on function usage_summary(timestamptz, timestamptz, text, text),
  usage_recorded_since() to authenticated;

-- ---- Retensi 12 bulan -------------------------------------------------------
create or replace function usage_purge_expired() returns bigint
  language plpgsql security definer set search_path = public as $$
declare
  n bigint;
begin
  perform set_config('msdps.usage_purge', 'on', true);
  delete from usage_page_views where occurred_at < now() - interval '12 months';
  get diagnostics n = row_count;
  perform set_config('msdps.usage_purge', 'off', true);
  return n;
end $$;

-- Murni tugas internal (pola 0315): pg_cron jalan sebagai postgres.
revoke execute on function usage_purge_expired() from public, anon, authenticated;

-- Tanggal 1 pukul 18:30 UTC (= tanggal 2 pukul 01:30 WIB), 30 menit sesudah
-- msdps_retention_monthly (0315) supaya tidak berbarengan.
select cron.schedule('msdps_usage_retention_monthly', '30 18 1 * *',
  $$select usage_purge_expired()$$);
