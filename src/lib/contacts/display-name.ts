/**
 * Single source of truth for "what do we call this contact in the UI".
 *
 * Three fields can name a contact, and they are NOT interchangeable:
 *
 *   - `name`            — operator-owned. Typed by a human, imported from
 *                         the ops spreadsheet, or set via the public API.
 *                         Nothing WhatsApp reports may ever overwrite it.
 *   - `wa_profile_name` — the contact's own WhatsApp profile name
 *                         (Meta calls it the "pushname"). Contact-owned,
 *                         rewritten on every inbound message.
 *   - `phone`           — always present, never pretty.
 *
 * Display order is name → wa_profile_name → phone, so a contact we have
 * never manually named still reads sensibly in the inbox instead of
 * showing a bare number, while an operator-entered name always wins.
 *
 * Use this everywhere a contact is rendered rather than repeating
 * `contact.name || contact.phone` inline — that older idiom silently
 * skips `wa_profile_name` and makes un-named contacts look broken.
 */

/** The subset of a contact row any display surface needs. */
export interface DisplayNameContact {
  name?: string | null;
  wa_profile_name?: string | null;
  phone?: string | null;
}

/**
 * Best available human label for `contact`.
 *
 * Blank-but-present values (`''`, `'   '`) are treated as absent, so a
 * contact whose name was cleared falls through to the next candidate
 * instead of rendering as an empty string.
 *
 * @param fallback Rendered when the contact is missing entirely or has
 *   no usable field — pass a translated "Unknown contact" string.
 */
export function contactDisplayName(
  contact: DisplayNameContact | null | undefined,
  fallback = "",
): string {
  return (
    contact?.name?.trim() ||
    contact?.wa_profile_name?.trim() ||
    contact?.phone?.trim() ||
    fallback
  );
}

/**
 * True when the contact has no operator-entered name — i.e. the label
 * `contactDisplayName` returns is a WhatsApp profile name or the raw
 * phone number. Lets a surface mark the label as provisional (the
 * Contacts table italicises it) without re-deriving the fallback chain.
 */
export function hasOperatorName(
  contact: DisplayNameContact | null | undefined,
): boolean {
  return Boolean(contact?.name?.trim());
}

/**
 * Columns every query feeding `contactDisplayName` must select. Spread
 * into a PostgREST `.select()` string so adding a future name source
 * doesn't mean hunting down each call site.
 */
export const CONTACT_DISPLAY_COLUMNS = "name, wa_profile_name, phone";
