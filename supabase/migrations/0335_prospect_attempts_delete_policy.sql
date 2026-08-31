-- =============================================================================
-- MSDPS · Leads/BD · Migration 0335 — prospect_attempts: RLS delete policy
-- =============================================================================
-- 0101_module1_leads.sql hanya membuat policy select/insert/update untuk
-- prospect_attempts. leads_delete (0331) mengizinkan hapus lead, tapi lead
-- yang sudah pernah diambil (claimLead) punya baris prospect_attempts anak
-- (FK parent_lead_id) — tanpa policy delete di sini, force-delete lead+prospek
-- (lib/actions/leads.ts deleteLead/deleteLeadsBulk, force=1) akan senyap
-- menghapus 0 baris prospect_attempts lalu tetap gagal di FK saat hapus lead.
-- Cakupan sama seperti leads_delete: BizDev/Marketing/director.
-- =============================================================================

do $$ begin
  create policy attempts_delete on prospect_attempts for delete to authenticated
    using (auth_division() in ('BizDev','Marketing') or is_director());
exception when duplicate_object then null;
end $$;
