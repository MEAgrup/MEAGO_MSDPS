-- =============================================================================
-- MSDPS · Phase 0 · Migration 0009 — Audit trigger on employees
-- =============================================================================
-- Employee management (Director/OD adding or changing staff) is an auditable
-- admin action. Attach the generic capture_audit trigger. Placed after 0005
-- (where capture_audit is defined).
-- =============================================================================

create trigger trg_audit_employees after insert or update on employees
  for each row execute function capture_audit('employee');
