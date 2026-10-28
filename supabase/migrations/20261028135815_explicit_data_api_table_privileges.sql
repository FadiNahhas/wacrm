-- Explicit Data API table privileges for the current application access paths.
-- Supabase stops adding implicit grants to NEW public tables on 2026-10-30.
-- Existing tables retain their grants; this additive migration also makes fresh
-- installs independent of those defaults. It does not normalize/revoke old ACLs.
-- See docs/data-api-table-privileges.md for the role matrix and source evidence.
--
-- Keep RLS, policies, function ACLs, and existing column grants unchanged.
-- No anonymous table access is required: invitation peek uses a definer RPC.
-- No sequence grants are needed: all application IDs are UUIDs.
-- Do not replace these with ALL TABLES, ALL PRIVILEGES, or default grants.

-- authenticated: session clients, including cookie-authenticated server routes.
GRANT SELECT, INSERT, DELETE ON TABLE public.account_invitations TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_configs TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_knowledge_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_knowledge_documents TO authenticated;
GRANT SELECT ON TABLE public.ai_usage_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.api_keys TO authenticated;
GRANT SELECT ON TABLE public.automation_logs TO authenticated;
GRANT SELECT ON TABLE public.automations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.broadcast_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_custom_values TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.contact_notes TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.custom_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deals TO authenticated;
GRANT SELECT ON TABLE public.flow_nodes TO authenticated;
GRANT SELECT ON TABLE public.flow_run_events TO authenticated;
GRANT SELECT ON TABLE public.flow_runs TO authenticated;
GRANT SELECT ON TABLE public.flows TO authenticated;
-- All writes remain inside SECURITY DEFINER touch_presence().
GRANT SELECT ON TABLE public.member_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_templates TO authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;
-- 027 already grants UPDATE(read_at); NEVER grant table-level UPDATE here.
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipeline_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipelines TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.quick_replies TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_config TO authenticated;

-- service_role: checked server routes, webhooks and engines.
GRANT SELECT ON TABLE public.accounts TO service_role;
GRANT SELECT ON TABLE public.ai_configs TO service_role;
GRANT SELECT ON TABLE public.ai_knowledge_chunks TO service_role;
GRANT INSERT ON TABLE public.ai_usage_log TO service_role;
GRANT SELECT, UPDATE ON TABLE public.api_keys TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.automation_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.automation_pending_executions TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.automation_steps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automations TO service_role;
GRANT SELECT, UPDATE ON TABLE public.broadcast_recipients TO service_role;
GRANT SELECT, UPDATE ON TABLE public.broadcasts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contact_custom_values TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.contact_tags TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contacts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversations TO service_role;
GRANT SELECT ON TABLE public.custom_fields TO service_role;
GRANT INSERT ON TABLE public.deals TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.flow_nodes TO service_role;
GRANT SELECT, INSERT ON TABLE public.flow_run_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.flow_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_reactions TO service_role;
GRANT SELECT, UPDATE ON TABLE public.message_templates TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.messages TO service_role;
GRANT SELECT ON TABLE public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quick_replies TO service_role;
GRANT SELECT, INSERT ON TABLE public.tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_endpoints TO service_role;
GRANT SELECT, UPDATE ON TABLE public.whatsapp_config TO service_role;
