-- =============================================================================
-- MSDPS · Migration 0316 — Fix RLS leads: OD boleh insert/update (konsisten select)
-- =============================================================================
-- Gejala: BizDev Workspace (/bizdev) menampilkan error saat menekan "Kirim ke
-- Pool Leads" pada form "Lead Shop → Pool Leads". Server action createShopLead
-- (lib/actions/bizdev.ts) meng-insert ke tabel `leads`, lalu Postgres menolak:
--   new row violates row-level security policy for table "leads"
--
-- Penyebab: BizDev Workspace SENGAJA dibuka untuk manajemen (is_od()/is_director())
-- selain divisi BizDev — layout & page memakai `mgmt = is_od || is_director`.
-- Tapi policy RLS `leads` tidak konsisten:
--   · leads_select : is_od() OR is_director() OR div in ('BizDev','Marketing')   ← OD boleh baca
--   · leads_insert :               is_director() OR div in ('BizDev','Marketing') ← OD TIDAK boleh tulis
--   · leads_update :               is_director() OR div in ('BizDev','Marketing') ← idem
-- Sehingga user OD (is_od, bukan director, divisi bukan BizDev/Marketing) bisa
-- MEMBUKA workspace & MEMBACA pool leads, tapi GAGAL menyimpan lead shop.
--
-- Pola rumah di seluruh modul MCN (0305/0306/0308) & lainnya selalu memberi
-- manajemen bypass penuh: `is_od() OR is_director() OR <divisi>` untuk insert &
-- update. Omission is_od() di 0101 (modul M1 lama) adalah kekhilafan. Perbaikan:
-- samakan leads_insert & leads_update dengan pola tsb (dan dengan leads_select).
-- =============================================================================

drop policy if exists leads_insert on leads;
create policy leads_insert on leads for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));

drop policy if exists leads_update on leads;
create policy leads_update on leads for update to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));
