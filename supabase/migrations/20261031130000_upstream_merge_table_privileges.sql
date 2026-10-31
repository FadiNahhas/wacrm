-- Table privileges the merged upstream code needs beyond this fork's explicit
-- matrix (20261028135815_explicit_data_api_table_privileges). Since Supabase's
-- 2026-10-30 change new public tables get no default grants, and this fork
-- grants every table explicitly, so each of these would otherwise fail at
-- runtime with "permission denied". All are service_role only.

-- Upstream 054 adds public.pending_message_statuses and revokes it from anon
-- and authenticated. message-status-sync.ts inserts (upsert with
-- ignoreDuplicates), reads and deletes these rows.
GRANT SELECT, INSERT, DELETE ON TABLE public.pending_message_statuses TO service_role;
REVOKE ALL ON TABLE public.pending_message_statuses FROM anon, authenticated;

-- steps-tree.ts replaceSteps now upserts the steps it keeps (ON CONFLICT DO
-- UPDATE) instead of deleting and re-inserting them all.
GRANT UPDATE ON TABLE public.automation_steps TO service_role;

-- template-webhook.ts stubs a local row for a status/quality webhook about a
-- template this account has no row for yet.
GRANT INSERT ON TABLE public.message_templates TO service_role;

-- resolve-import-tags.ts retires the losing duplicate after a tag-creation
-- race on the v1 API (service-role client).
GRANT DELETE ON TABLE public.tags TO service_role;
