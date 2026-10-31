-- CI-only: exact ACL contract for a FRESH schema with table defaults disabled.
-- Single statement for `supabase db query --local --file`.
DO $verify$
DECLARE
  expected record;
  role_name text;
  op text;
  allowed text;
  table_oid oid;
  actual_tables text[];
  expected_tables text[] := ARRAY[
    'account_invitations',
    'accounts',
    'ai_configs',
    'ai_knowledge_chunks',
    'ai_knowledge_documents',
    'ai_usage_log',
    'api_keys',
    'automation_logs',
    'automation_pending_executions',
    'automation_steps',
    'automations',
    'broadcast_recipients',
    'broadcasts',
    'contact_custom_values',
    'contact_notes',
    'contact_tags',
    'contacts',
    'conversations',
    'custom_fields',
    'deals',
    'flow_nodes',
    'flow_run_events',
    'flow_runs',
    'flows',
    'member_presence',
    'message_reactions',
    'message_templates',
    'messages',
    'notifications',
    'pending_message_statuses',
    'pipeline_stages',
    'pipelines',
    'profiles',
    'quick_replies',
    'tags',
    'webhook_endpoints',
    'whatsapp_config'
  ];
BEGIN
  SELECT array_agg(c.relname::text ORDER BY c.relname)
    INTO actual_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype = 'e'
      );
  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'Public table inventory changed: %. Review grants and update the matrix.', actual_tables;
  END IF;

  FOR expected IN SELECT * FROM (VALUES
      ('account_invitations', 'SID', ''),
      ('accounts', 'SU', 'S'),
      ('ai_configs', 'SIUD', 'S'),
      ('ai_knowledge_chunks', 'SID', 'S'),
      ('ai_knowledge_documents', 'SIUD', ''),
      ('ai_usage_log', 'S', 'I'),
      ('api_keys', 'SIU', 'SU'),
      ('automation_logs', 'S', 'SIU'),
      ('automation_pending_executions', '', 'SIU'),
      ('automation_steps', '', 'SIUD'),
      ('automations', 'S', 'SIUD'),
      ('broadcast_recipients', 'SIU', 'SU'),
      ('broadcasts', 'SIUD', 'SU'),
      ('contact_custom_values', 'SIUD', 'SIU'),
      ('contact_notes', 'SID', ''),
      ('contact_tags', 'SID', 'SID'),
      ('contacts', 'SIUD', 'SIU'),
      ('conversations', 'SIU', 'SIU'),
      ('custom_fields', 'SIUD', 'S'),
      ('deals', 'SIUD', 'I'),
      ('flow_nodes', 'S', 'SID'),
      ('flow_run_events', 'S', 'SI'),
      ('flow_runs', 'S', 'SIU'),
      ('flows', 'S', 'SIUD'),
      ('member_presence', 'S', ''),
      ('message_reactions', 'SIUD', 'SIUD'),
      ('message_templates', 'SIUD', 'SIU'),
      ('messages', 'SI', 'SIU'),
      ('notifications', 'S', ''),
      ('pending_message_statuses', '', 'SID'),
      ('pipeline_stages', 'SIUD', ''),
      ('pipelines', 'SIUD', ''),
      ('profiles', 'SU', 'S'),
      ('quick_replies', 'S', 'SIUD'),
      ('tags', 'SID', 'SID'),
      ('webhook_endpoints', '', 'SIUD'),
      ('whatsapp_config', 'SIUD', 'SU')
  ) AS matrix(table_name, authenticated_ops, service_ops)
  LOOP
    table_oid := to_regclass(format('public.%I', expected.table_name));
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = table_oid) THEN
      RAISE EXCEPTION 'RLS disabled on %', expected.table_name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      allowed := CASE role_name
        WHEN 'authenticated' THEN expected.authenticated_ops
        WHEN 'service_role' THEN expected.service_ops ELSE '' END;
      FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(role_name, table_oid, op)
          IS DISTINCT FROM (position(left(op, 1) IN allowed) > 0) THEN
          RAISE EXCEPTION 'Unexpected % privilege for % on % (expected operations: %)',
            op, role_name, expected.table_name, allowed;
        END IF;
      END LOOP;
      IF has_table_privilege(role_name, table_oid, 'TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Unexpected destructive/DDL privilege for % on %', role_name, expected.table_name;
      END IF;
      -- A column grant must not silently bypass a missing table grant.
      FOR op IN SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) LOOP
        IF position(left(op, 1) IN allowed) = 0
          AND NOT (role_name = 'authenticated' AND expected.table_name = 'notifications' AND op = 'UPDATE')
          AND has_any_column_privilege(role_name, table_oid, op) THEN
          RAISE EXCEPTION 'Unexpected column % for % on %', op, role_name, expected.table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
    OR EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = 'public.notifications'::regclass
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'read_at'
        AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
    ) THEN
    RAISE EXCEPTION 'notifications must retain exactly UPDATE(read_at) for authenticated';
  END IF;

  RAISE NOTICE 'Data API table privilege matrix passed (37 tables, 3 roles).';
END
$verify$;
