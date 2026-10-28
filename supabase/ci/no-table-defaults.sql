-- CI fixture only. The workflow copies this into its disposable checkout as
-- migration 000 so ALL real migrations run without implicit table privileges.
-- Never deploy this fixture. It changes defaults only in the local CI database.
DO $$
DECLARE
  api_role text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'no-table-defaults fixture requires an empty public application schema';
  END IF;

  -- Defaults can be global or per-schema; both contribute to the final ACL.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

  CREATE TABLE public._wacrm_acl_probe (id uuid);
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(api_role, 'public._wacrm_acl_probe',
                          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Implicit table privileges still active for %', api_role;
    END IF;
  END LOOP;
  DROP TABLE public._wacrm_acl_probe;
END
$$;
