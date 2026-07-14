-- =============================================================================
-- MSDPS · Fase B · Hardening — function grants (security advisors)
-- =============================================================================
-- Same policy as Phase 0: trigger/validator bodies and internal utilities are
-- not callable from the API; the two RPCs the app calls (close_deal,
-- verify_payment) stay callable by signed-in users only (they self-authorize).
-- =============================================================================

revoke execute on function campaigns_validate()      from public, anon, authenticated;
revoke execute on function leads_validate()           from public, anon, authenticated;
revoke execute on function attempts_validate()        from public, anon, authenticated;
revoke execute on function attempts_on_win()          from public, anon, authenticated;
revoke execute on function merchants_validate()       from public, anon, authenticated;
revoke execute on function services_validate()        from public, anon, authenticated;
revoke execute on function transactions_validate()    from public, anon, authenticated;
revoke execute on function installments_validate()    from public, anon, authenticated;
revoke execute on function payouts_validate()         from public, anon, authenticated;
revoke execute on function mpr_validate()             from public, anon, authenticated;
revoke execute on function normalize_phone_id(text)   from public, anon, authenticated;

revoke execute on function close_deal(uuid,text,text,text,text,numeric,numeric,service_type[],numeric,payment_intent) from public, anon;
grant  execute on function close_deal(uuid,text,text,text,text,numeric,numeric,service_type[],numeric,payment_intent) to authenticated;
revoke execute on function verify_payment(uuid,numeric,text) from public, anon;
grant  execute on function verify_payment(uuid,numeric,text) to authenticated;
