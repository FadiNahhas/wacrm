-- CI-only integration checks. One statement for supabase db query.
-- All fixtures and role/JWT changes roll back in the inner subtransaction.
DO $verify$
DECLARE
  owner_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  account_a uuid;
  account_b uuid;
  contact_a uuid := gen_random_uuid();
  contact_b uuid := gen_random_uuid();
  conversation_a uuid := gen_random_uuid();
  quick_id uuid := gen_random_uuid();
  doc_a uuid := gen_random_uuid();
  doc_b uuid := gen_random_uuid();
  v_tag_id uuid := gen_random_uuid();
  affected integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
      (owner_id, owner_id || '@acl-test.invalid', '{"full_name":"ACL owner"}'),
      (viewer_id, viewer_id || '@acl-test.invalid', '{"full_name":"ACL viewer"}'),
      (outsider_id, outsider_id || '@acl-test.invalid', '{"full_name":"ACL outsider"}');
    SELECT account_id INTO STRICT account_a FROM public.profiles WHERE user_id = owner_id;
    SELECT account_id INTO STRICT account_b FROM public.profiles WHERE user_id = outsider_id;
    UPDATE public.profiles SET account_id = account_a, account_role = 'viewer' WHERE user_id = viewer_id;

    INSERT INTO public.contacts (id, user_id, account_id, phone, name) VALUES
      (contact_a, owner_id, account_a, '+15550000101', 'Own contact'),
      (contact_b, outsider_id, account_b, '+15550000102', 'Foreign contact');
    INSERT INTO public.ai_knowledge_documents (id, account_id, title, content) VALUES
      (doc_a, account_a, 'Own', 'privilegetest'),
      (doc_b, account_b, 'Foreign', 'privilegetest');
    INSERT INTO public.ai_knowledge_chunks (document_id, account_id, content) VALUES
      (doc_a, account_a, 'privilegetest'), (doc_b, account_b, 'privilegetest');

    PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.contacts SET name = 'Edited own contact' WHERE id = contact_a;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Owner contact update failed'; END IF;
    -- Inserting the thread must still create a notification via the definer trigger.
    INSERT INTO public.conversations (id, contact_id, user_id, account_id, assigned_agent_id)
      VALUES (conversation_a, contact_a, owner_id, account_a, viewer_id);
    -- CSV imports use ON CONFLICT DO NOTHING, so contact_tags needs no UPDATE.
    INSERT INTO public.tags (id, user_id, account_id, name) VALUES (v_tag_id, owner_id, account_a, 'ACL test');
    INSERT INTO public.contact_tags (contact_id, tag_id) VALUES (contact_a, v_tag_id)
      ON CONFLICT (contact_id, tag_id) DO NOTHING;
    INSERT INTO public.contact_tags (contact_id, tag_id) VALUES (contact_a, v_tag_id)
      ON CONFLICT (contact_id, tag_id) DO NOTHING;
    DELETE FROM public.contact_tags WHERE contact_id = contact_a AND contact_tags.tag_id = v_tag_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Contact-tag import/delete failed'; END IF;
    -- Knowledge ingestion's real callers pass the authenticated session client.
    DELETE FROM public.ai_knowledge_chunks WHERE document_id = doc_a;
    INSERT INTO public.ai_knowledge_chunks (document_id, account_id, content)
      VALUES (doc_a, account_a, 'privilegetest');
    RESET ROLE;

    PERFORM set_config('request.jwt.claim.sub', viewer_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    IF (SELECT count(*) FROM public.contacts WHERE id IN (contact_a, contact_b)) <> 1 THEN
      RAISE EXCEPTION 'Contact SELECT did not preserve account isolation';
    END IF;
    BEGIN
      INSERT INTO public.contacts (user_id, account_id, phone) VALUES (viewer_id, account_a, '+15550000103');
      RAISE EXCEPTION 'Viewer INSERT unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.profiles SET full_name = 'Edited viewer' WHERE user_id = viewer_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Profile self-service update failed'; END IF;
    BEGIN
      UPDATE public.profiles SET account_role = 'owner' WHERE user_id = viewer_id;
      RAISE EXCEPTION 'Profile privilege guard was bypassed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.profiles SET account_id = account_b WHERE user_id = viewer_id;
      RAISE EXCEPTION 'Profile account guard was bypassed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    IF (SELECT count(*) FROM public.notifications WHERE conversation_id = conversation_a) <> 1 THEN
      RAISE EXCEPTION 'Assignment trigger failed to create recipient notification';
    END IF;
    UPDATE public.notifications SET read_at = now() WHERE conversation_id = conversation_a;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Notification read_at update failed'; END IF;
    BEGIN
      UPDATE public.notifications SET title = 'Forbidden' WHERE conversation_id = conversation_a;
      RAISE EXCEPTION 'Notification immutable column update unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM public.touch_presence('online');
    PERFORM public.touch_presence('away');
    IF NOT EXISTS (SELECT 1 FROM public.member_presence WHERE user_id = viewer_id AND status = 'away') THEN
      RAISE EXCEPTION 'Presence definer RPC failed without direct write grants';
    END IF;
    BEGIN
      UPDATE public.member_presence SET status = 'online' WHERE user_id = viewer_id;
      RAISE EXCEPTION 'Direct presence write unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.quick_replies (account_id, user_id, title, content_text)
        VALUES (account_a, viewer_id, 'Forbidden', 'test');
      RAISE EXCEPTION 'Session quick-reply write unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF (SELECT count(*) FROM public.match_ai_knowledge_fts(account_a, 'privilegetest', 10)) <> 1
      OR (SELECT count(*) FROM public.match_ai_knowledge_fts(account_b, 'privilegetest', 10)) <> 0 THEN
      RAISE EXCEPTION 'Invoker knowledge search failed or leaked another account';
    END IF;
    RESET ROLE;

    -- Test the service role with no user claims, as a webhook/engine would run.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    IF (SELECT count(*) FROM public.contacts WHERE id IN (contact_a, contact_b)) <> 2 THEN
      RAISE EXCEPTION 'Service-role read failed';
    END IF;
    INSERT INTO public.quick_replies (id, account_id, user_id, title, content_text)
      VALUES (quick_id, account_a, owner_id, 'Server snippet', 'test');
    UPDATE public.quick_replies SET title = 'Updated snippet' WHERE id = quick_id;
    IF NOT EXISTS (SELECT 1 FROM public.quick_replies WHERE id = quick_id AND title = 'Updated snippet') THEN
      RAISE EXCEPTION 'Service-role quick-reply CRUD failed';
    END IF;
    DELETE FROM public.quick_replies WHERE id = quick_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Service-role quick-reply delete failed'; END IF;
    INSERT INTO public.ai_usage_log (account_id, mode, provider, model)
      VALUES (account_a, 'draft', 'openai', 'acl-test');
    IF (SELECT count(*) FROM public.match_ai_knowledge_fts(account_b, 'privilegetest', 10)) <> 1 THEN
      RAISE EXCEPTION 'Service-role invoker knowledge search failed';
    END IF;
    BEGIN
      SELECT count(*) INTO affected FROM public.member_presence;
      RAISE EXCEPTION 'Service bypassed missing table grant';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    SET LOCAL ROLE anon;
    BEGIN
      SELECT count(*) INTO affected FROM public.contacts;
      RAISE EXCEPTION 'Anonymous table read unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- Anonymous invite lookup remains callable through its supervised RPC.
    PERFORM public.peek_invitation('nonexistent-acl-test-token');
    RESET ROLE;

    -- Successful checks also roll back every fixture row and local setting.
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'rollback successful test fixtures';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  END;
  RAISE NOTICE 'Protected application paths passed; fixture rows rolled back.';
END
$verify$;
