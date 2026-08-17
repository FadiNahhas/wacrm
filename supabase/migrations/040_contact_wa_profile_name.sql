-- ============================================================
-- 040_contact_wa_profile_name.sql — separate the WhatsApp profile
-- name from the operator-owned contact name.
--
-- The problem
--
--   The inbound webhook mirrored Meta's `contacts[].profile.name`
--   (the "pushname" — the contact's own WhatsApp display name) into
--   `contacts.name` on every single inbound message. `contacts.name`
--   is operator-owned data, maintained externally and imported, so
--   every message a contact sent silently destroyed the name an
--   operator had entered for them.
--
--   The fix is in application code (the webhook's findOrCreateContact
--   and the public-API send path's resolveConversationByPhone): the
--   pushname now lands in `wa_profile_name`, and `contacts.name` is
--   only ever filled when it is null/empty — never overwritten.
--
-- What this migration does
--
--   1. Adds `contacts.wa_profile_name` (already applied by hand in
--      production; the IF NOT EXISTS makes re-running a no-op).
--   2. Replaces `filter_contacts_by_tags` so the Contacts page's
--      search box matches the WhatsApp profile name as well. Without
--      this, a contact nobody has named is unfindable by the only
--      name the operator has ever seen for them, but ONLY when a tag
--      filter is also active — the un-filtered list path searches
--      client-side and already covers the column.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- 1. the column ------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS wa_profile_name TEXT;

COMMENT ON COLUMN public.contacts.wa_profile_name IS
  'WhatsApp profile name (pushname) reported by the contact. Inbound message handlers must write
   here, never to contacts.name, which is operator-owned.';

COMMENT ON COLUMN public.contacts.name IS
  'Operator-owned display name. Written only by a human (contact form, CSV import) or an explicit
   API call. NULL until someone names the contact — render via contactDisplayName(), which falls
   back name -> wa_profile_name -> phone.';

-- ---- 2. tag-filtered search over the new column --------------
-- Unchanged from migration 025 except for the added
-- `wa_profile_name` predicate in the `matched` CTE. Signature is
-- identical, so no GRANT/REVOKE changes are needed.
CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same search the un-filtered list applies.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.wa_profile_name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated;
