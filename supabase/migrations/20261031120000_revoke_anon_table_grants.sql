-- Revoke Data API table access from the anon role.
--
-- Tables created before Supabase's 2026-10-30 change carry the platform's
-- historical default ACL, which granted anon every table privilege. Row-level
-- security kept those grants harmless (every policy goes through
-- is_account_member(), which needs auth.uid()), but they left RLS as the only
-- barrier between the public anon key and the data. No application path needs
-- them: unauthenticated pages only call the SECURITY DEFINER RPCs
-- peek_invitation / redeem_invitation, which run with their owner's
-- privileges. supabase/ci/verify-table-privileges.sql already expects anon to
-- hold no table privileges; this brings existing deployments in line.
--
-- Function EXECUTE grants, storage, RLS and the authenticated / service_role
-- grants are deliberately unchanged.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Tables created by later migrations (which run as postgres) must not pick
-- the grant back up from postgres's default privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
