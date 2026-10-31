-- Upstream 054 adds public.pending_message_statuses and revokes it from anon
-- and authenticated, relying on the platform's old default grants for
-- service_role. Since Supabase's 2026-10-30 change a new public table gets no
-- default privileges, and this fork grants every table explicitly (see
-- 20261028135815_explicit_data_api_table_privileges), so the status webhook's
-- parking path would fail with "permission denied".
--
-- message-status-sync.ts only ever inserts (upsert with ignoreDuplicates),
-- reads and deletes these rows through the service-role client.
GRANT SELECT, INSERT, DELETE ON TABLE public.pending_message_statuses TO service_role;
REVOKE ALL ON TABLE public.pending_message_statuses FROM anon, authenticated;
