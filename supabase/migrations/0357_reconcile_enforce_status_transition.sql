-- 0357 — rekonsiliasi enforce_status_transition() di production
--
-- TEMUAN 2026-09-06. Sidik jari per objek (scripts/schema_fingerprint.sql)
-- melaporkan staging dan production identik di 11 dari 12 kategori; yang
-- berbeda hanya `function`. Sama-sama 106 fungsi, jadi tidak ada yang hilang
-- atau kelebihan — ada definisi yang menyimpang.
--
-- Dari 22 fungsi yang hash mentahnya berbeda, 21 hanya berbeda komentar dan
-- whitespace (hash ternormalisasi sama). Sisa satu berbeda SUNGGUHAN:
--
--   repo & staging : '[transisi status tidak diizinkan: % → %]'   (panah Unicode)
--   production     : '[transisi status tidak diizinkan: % -> %]'  (panah ASCII)
--
-- Yang menjalankan production memang versi ASCII — dibuktikan dari kolom
-- `statements` milik baris 0004_phase0_status_machine di
-- supabase_migrations.schema_migrations, bukan dari nama migrasinya (jebakan
-- #5: nama migrasi tidak membuktikan SQL apa yang jalan; 0004 termasuk 14 file
-- repo yang sudah diedit SESUDAH diterapkan). Jadi ini bukan perubahan liar
-- lewat SQL Editor, melainkan sisa edit repo yang tidak pernah ikut di-apply.
--
-- Dampak perilaku: NIHIL. Yang berbeda hanya teks pesan error; logika transisi,
-- pengecekan token, dan stempel actor/waktu identik. Diselaraskan supaya
-- perbandingan skema berikutnya bersih — selisih kosmetik yang dibiarkan
-- membuat orang berikutnya harus membedah 22 fungsi lagi untuk sampai ke
-- kesimpulan yang sama.
--
-- Isi di bawah disalin PERSIS dari 0004_phase0_status_machine.sql. Aman
-- dijalankan berulang dan aman di staging (di sana sudah begini — no-op).

create or replace function enforce_status_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity   text := tg_argv[0];
  v_allowed  text[];
  v_found    boolean;
begin
  -- Only act when status actually changes.
  if new.status is distinct from old.status then
    select allowed_tokens, true
      into v_allowed, v_found
    from status_transitions
    where entity = v_entity
      and from_status = old.status::text
      and to_status   = new.status::text;

    if not coalesce(v_found, false) then
      raise exception '[transisi status tidak diizinkan: % → %]', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if v_allowed is not null and not (v_allowed && actor_tokens()) then
      raise exception '[anda tidak berwenang melakukan transisi status ini]'
        using errcode = 'insufficient_privilege';
    end if;

    -- Stamp actor + time on every successful transition (immutable history feeds audit log).
    new.status_changed_by := auth.uid();
    new.status_changed_at := now();
  end if;

  return new;
end $$;
