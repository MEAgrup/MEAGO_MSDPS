-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0300 — Enum extensions
-- =============================================================================
-- Add new division types for Creator Management and Acquisition.
-- Add new lead source for MCN Shop leads.
-- These must be separate transactions from their usage (Postgres constraint).
-- =============================================================================

alter type division add value 'CreatorManagement';
alter type division add value 'Acquisition';

alter type lead_source add value if not exists 'MCN Shop Lead';
