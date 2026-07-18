-- 0313 — Tinjauan advisor "security_definer_view" atas 5 view lama (pra-produksi).
-- Hasil tinjauan (2026-07-18):
--   v_merchant_board       KEEP definer — role-gate di WHERE (is_od/is_director/Account/divisi);
--                          harus lintas-RLS tabel briefs/services/merchants/unit divisi.
--   v_management_dashboard KEEP definer — gate WHERE is_od() or is_director().
--   v_okr_attainment       KEEP definer — gate WHERE cermin policy okr_select (0209).
--   v_speed_score          KEEP definer — proyeksi ber-gate dari v_speed_score_internal
--                          yang di-revoke dari authenticated (0208); invoker = tak terbaca.
--   v_team_portal_tasks    FLIP ke invoker — satu-satunya yang tidak disengaja: dua view
--                          saudaranya (_performance/_blocks) sudah invoker sejak 0210.
--                          Flip tidak mengubah hasil: basisnya v_merchant_board tetap
--                          definer ber-gate dan sudah di-grant ke authenticated; WHERE
--                          view ini (auth.uid()/auth_division()) identik di kedua mode.

alter view public.v_team_portal_tasks set (security_invoker = true);

-- Dokumentasikan keputusan pada 4 view yang dipertahankan, agar audit advisor
-- berikutnya tidak mengangkat ulang temuan yang sama.
comment on view v_merchant_board is
  'M11: kartu Kanban per Brief, kolom kanonik 6-state derived real-time. SECURITY DEFINER DISENGAJA — role-gate di WHERE (0207/0210); jangan flip ke invoker.';
comment on view v_management_dashboard is
  'M15 Management Dashboard (Director/OD). SECURITY DEFINER DISENGAJA — gate WHERE is_od/is_director (0210); jangan flip ke invoker.';
comment on view v_okr_attainment is
  'M14: attainment OKR kuartal-berjalan per target aktif. SECURITY DEFINER DISENGAJA — gate WHERE cermin okr_select (0209); jangan flip ke invoker.';
comment on view v_speed_score is
  'M12: speed score publik = proyeksi ber-gate dari v_speed_score_internal (revoked dari authenticated). SECURITY DEFINER DISENGAJA (0208); flip ke invoker membuat view tak terbaca.';
comment on view v_team_portal_tasks is
  'M15 Team Portal: My Tasks — kartu saya + antrian divisi + (AM) portofolio. security_invoker=true (0313, paritas dengan _performance/_blocks); gate lintas-RLS tetap di v_merchant_board.';
