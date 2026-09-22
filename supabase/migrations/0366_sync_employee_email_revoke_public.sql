-- Trigger functions must not be callable directly via PostgREST RPC (matches
-- convention for other _validate/_after_change trigger functions in this repo).
revoke execute on function sync_employee_email() from public, anon, authenticated;
