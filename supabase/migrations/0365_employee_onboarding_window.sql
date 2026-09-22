-- =============================================================================
-- MSDPS · Migration 0365 — Jendela onboarding: SPV/Lead boleh menambah timnya
-- =============================================================================
-- Kenapa ada: MEAGO! dipakai SELURUH tim, tapi sejak Phase 0 (migrasi 0002)
-- satu-satunya jalur menambah karyawan adalah OD/Director (`employees_manage`).
-- Saat pengisian awal, seluruh divisi harus mendaftarkan anggotanya sekaligus —
-- memaksa semuanya lewat OD membuat OD jadi leher botol.
--
-- Pelonggarannya SENGAJA DIBUAT SEMENTARA dan menutup dirinya sendiri:
--   1. Wewenang lead dibaca dari app_config `employees.lead_onboarding`, yang
--      punya `closes_at`. Lewat tanggal itu policy berhenti mengizinkan TANPA
--      ada yang perlu ingat mencabutnya — pencabutan adalah default, bukan
--      pekerjaan tambahan. OD juga bisa menutup lebih awal (enabled=false).
--   2. Yang boleh dibuat lead sangat sempit, dan sempitnya ditegakkan di WITH
--      CHECK, bukan di UI: hanya rank 'staff', hanya divisinya sendiri, nol
--      flag is_od/is_director, dan WAJIB bertanda password sementara. Lead
--      tidak bisa membuat lead lain, tidak bisa membuat OD, tidak bisa membuat
--      akun berpassword permanen.
--   3. Lead TIDAK mendapat UPDATE/DELETE. Salah input = OD yang membetulkan.
--
-- Setelah jendela tutup, matriks kembali persis seperti sebelum migrasi ini:
-- hanya OD/Director yang menambah karyawan. Tidak ada yang perlu di-drop.
--
-- Password sementara: akun buatan lead ditandai `must_change_password`, dan
-- aplikasi menahan pemiliknya di /ganti-password sampai ia menggantinya sendiri.
-- Password yang diserahkan lead karenanya tidak pernah jadi password permanen.
-- =============================================================================

-- ---- Kolom jejak pembuatan akun --------------------------------------------
-- Nullable tanpa default: baris lama memang tidak tercatat asal-usulnya, dan
-- menebaknya ('od' untuk semua) akan jadi data palsu di tabel yang ter-audit.
alter table employees
  add column if not exists created_by           uuid references employees(id),
  add column if not exists created_via          text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at  timestamptz;

do $$ begin
  alter table employees add constraint employees_created_via_chk
    check (created_via is null or created_via in ('od','lead_window'));
exception when duplicate_object then null; end $$;

comment on column employees.created_by is
  'Karyawan yang membuat akun ini. NULL = dibuat sebelum migrasi 0365 (seed/manual).';
comment on column employees.created_via is
  'Jalur pembuatan: od = OD/Director, lead_window = SPV/Lead lewat jendela onboarding (0365).';
comment on column employees.must_change_password is
  'TRUE = password yang dipegang pemilik akun masih password sementara; aplikasi menahannya di /ganti-password.';

-- ---- Konfigurasi jendela ----------------------------------------------------
-- Bentuk value:
--   {"enabled": bool, "opens_at": ts|null, "closes_at": ts|null,
--    "divisions": [division]|null, "note": text|null}
-- divisions null/[] = semua divisi. opens_at/closes_at null = tanpa batas di
-- sisi itu (closes_at null + enabled true = jendela yang HARUS ditutup manual —
-- dihindari; seed di bawah selalu memberi tanggal tutup).
insert into app_config (key, value) values
  ('employees.lead_onboarding',
   jsonb_build_object(
     'enabled',   true,
     'opens_at',  null,
     'closes_at', to_char((now() + interval '7 days') at time zone 'utc',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'divisions', null,
     'note',      'Pengisian tim awal MEAGO!. Tutup lebih cepat lewat /employees bila semua divisi sudah lengkap.'
   ))
on conflict (key) do nothing;

-- ---- Helper (SECURITY DEFINER: app_config dibaca tanpa bergantung RLS) ------
create or replace function lead_onboarding_window() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value from app_config where key = 'employees.lead_onboarding'),
    '{"enabled":false}'::jsonb
  )
$$;

comment on function lead_onboarding_window() is
  'Konfigurasi jendela onboarding lead (migrasi 0365). Sumber tunggal untuk RLS dan UI.';

create or replace function lead_onboarding_open() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((lead_onboarding_window() ->> 'enabled')::boolean, false)
     and (lead_onboarding_window() ->> 'opens_at' is null
          or (lead_onboarding_window() ->> 'opens_at')::timestamptz <= now())
     and (lead_onboarding_window() ->> 'closes_at' is null
          or (lead_onboarding_window() ->> 'closes_at')::timestamptz > now())
$$;

comment on function lead_onboarding_open() is
  'TRUE selama jendela onboarding lead masih berlaku. Lewat closes_at otomatis FALSE — pencabutan tidak perlu diingat siapa pun.';

create or replace function lead_onboarding_allows_division(p_division division) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when jsonb_typeof(lead_onboarding_window() -> 'divisions') <> 'array' then true
    when jsonb_array_length(lead_onboarding_window() -> 'divisions') = 0  then true
    else lead_onboarding_window() -> 'divisions' ? p_division::text
  end
$$;

-- ---- Policy: INSERT terbatas untuk lead selama jendela terbuka --------------
-- Policy permisif kedua di samping `employees_manage` (0002) — OD/Director
-- tidak terpengaruh sama sekali. Semua batasan ada di WITH CHECK supaya jalur
-- tulis apa pun (UI, PostgREST langsung, skrip) tunduk pada aturan yang sama.
drop policy if exists employees_lead_onboard_insert on employees;
create policy employees_lead_onboard_insert on employees
  for insert to authenticated
  with check (
    is_lead()
    and lead_onboarding_open()
    and lead_onboarding_allows_division(division)
    and division    = auth_division()   -- hanya divisinya sendiri
    and rank        = 'staff'           -- tidak bisa mengangkat lead baru
    and is_od       = false             -- tidak bisa memberi wewenang HR
    and is_director = false             -- tidak bisa memberi wewenang Director
    and active      = true
    and created_via = 'lead_window'     -- jejak wajib, bukan opsional
    and created_by  = auth.uid()
    and must_change_password            -- password yang diserahkan lead WAJIB sementara
  );

comment on policy employees_lead_onboard_insert on employees is
  'Jendela onboarding 0365: SPV/Lead menambah staff DIVISINYA SENDIRI selama lead_onboarding_open(). Tanpa UPDATE/DELETE — koreksi tetap wewenang OD/Director.';

-- ---- Pemilik akun menutup status "password sementara" -----------------------
-- Staff tidak punya UPDATE atas employees (dan tidak seharusnya punya), jadi
-- penutupan flag lewat satu fungsi definer yang HANYA menyentuh baris pemanggil
-- dan HANYA dua kolom itu. Password sendiri diganti lewat GoTrue, bukan di sini.
create or replace function mark_password_changed() returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception '[tidak terautentikasi]' using errcode = 'insufficient_privilege';
  end if;
  update employees
     set must_change_password = false,
         password_changed_at  = now()
   where id = auth.uid();
end $$;

comment on function mark_password_changed() is
  'Dipanggil pemilik akun sesudah GoTrue menerima password barunya. Hanya menyentuh baris auth.uid().';

revoke execute on function mark_password_changed() from public, anon;
grant execute on function mark_password_changed() to authenticated;

revoke execute on function lead_onboarding_window(), lead_onboarding_open(),
  lead_onboarding_allows_division(division) from anon;
grant execute on function lead_onboarding_window(), lead_onboarding_open(),
  lead_onboarding_allows_division(division) to authenticated;
