# Inline-edit custom field values from the inbox sidebar

## Context

The inbox contact sidebar (`src/components/inbox/contact-sidebar.tsx`) currently
shows a contact's custom field values read-only, via the shared
`useContactCustomFields` hook and the `CustomFieldValue` display component. To
change a value today, an admin has to leave the inbox and open the contact in
the Contacts page.

This spec adds inline editing of custom field *values* (not the field
catalogue itself) directly in the sidebar, gated to admins and owners.

## Scope

- **In scope:** editing the value of a custom field that is already shown in
  the sidebar (i.e. already has a non-empty value for this contact).
- **Out of scope:**
  - Tags editing (a separate feature, not part of this change).
  - Filling in a field that currently has no value for this contact — the
    sidebar only ever displays fields with a value; that stays true in edit
    mode too. Adding a brand-new value still requires the Contacts page.
  - Editing from the message-thread header's priority-fields preview — that
    stays display-only.
  - Changing the custom field catalogue (name, type, add/remove fields) —
    already handled by `CustomFieldsManager` / `CustomFieldsPanel`, admin-gated
    there today.

## Access control

Editable only when `useAuth().canEditSettings` is true (admin or owner — the
same predicate already gating the custom-fields catalogue elsewhere). Viewers
and agents see the identical read-only rendering that exists today. This is a
UI-level gate only; no RLS changes are made (existing `contact_custom_values`
RLS already allows any account member to write, matching
`contact-detail-view.tsx`'s existing behavior).

## Data flow

`useContactCustomFields` (`src/hooks/use-contact-custom-fields.ts`) gains one
new function:

```ts
updateFieldValue(fieldId: string, newValue: string): Promise<boolean>
```

Behavior:
- `newValue` non-empty → `supabase.from('contact_custom_values').upsert({ contact_id, custom_field_id: fieldId, value: newValue }, { onConflict: 'contact_id,custom_field_id' })`, relying on the existing `UNIQUE(contact_id, custom_field_id)` constraint (`supabase/migrations/001_initial_schema.sql`).
- `newValue` trims to empty → delete the matching row (`.delete().eq('contact_id', contactId).eq('custom_field_id', fieldId)`), so the field disappears from the display exactly as if it had never had a value (same rule as `fetchFields`, which already filters out empty values).
- On success: update the local `fields` state array directly (no refetch) — this hook instance is shared between the sidebar and the message-thread header (both consume it from `inbox/page.tsx`), so both stay in sync without an extra query.
- On failure: return `false` and leave `fields` state untouched; the caller (the input component) is responsible for reverting its own local edit state and surfacing an error.

This is a single-row upsert/delete, not the "delete all values for this
contact, then reinsert everything" bulk pattern `contact-detail-view.tsx`
uses — that pattern isn't safe to reuse here since the sidebar only knows
about the subset of fields that currently have values, not the full account
field catalogue.

## Components

**`CustomFieldValue`** (`src/components/inbox/custom-field-value.tsx`) gains
two new optional props:

```ts
editable?: boolean;
onCommit?: (newValue: string) => Promise<boolean>;
```

- When `editable` is falsy (or `onCommit` is absent): renders exactly as
  today — no behavior change for non-admins.
- When `editable` is true: the rendered chip/text becomes clickable
  (`role="button"`, hover affordance). Clicking swaps it for a focused
  `<input>` pre-filled with the current value, `dir="auto"` preserved.
  - `Enter` or blur commits: calls `onCommit(trimmedValue)`.
  - `Escape` cancels: reverts to the last committed value without calling
    `onCommit`.
  - While the commit is in flight, the input is disabled (brief spinner or
    opacity change — small enough not to need a dedicated loading prop, use
    local component state).
  - On `onCommit` resolving `false`: keep the input showing the attempted
    (not-yet-saved) text, show an error toast, and **stay in edit mode**
    (not blurred) so the admin can retry without retyping.
  - On success: exit edit mode; the parent's updated `fields` state flows
    back down as the new `value` prop.
- This mirrors the existing commit-on-blur pattern in `CustomFieldsManager`'s
  `FieldRow` (`src/components/contacts/custom-fields-manager.tsx`), which
  already does exactly this for field *names*.

**`ContactSidebar`** (`src/components/inbox/contact-sidebar.tsx`):
- Reads `canEditSettings` from `useAuth()`.
- Passes `editable={canEditSettings}` and an `onCommit` bound to
  `updateFieldValue(f.id, newValue)` to each `CustomFieldValue` in the Custom
  Fields section.

**`MessageThread`** header preview: unchanged — no `editable`/`onCommit`
props passed, so those instances keep rendering read-only.

## Error handling

- Upsert/delete failure (network or RLS rejection): toast error using a new
  i18n key (e.g. `Inbox.sidebar.customFieldSaveFailed`, added to `en.json`
  and `ko.json` alongside the existing `customFields` key), input stays in
  edit mode with the attempted value still shown so the admin doesn't lose
  their typing.
- Empty submit on a field that was already empty (shouldn't be reachable
  since empty fields aren't shown, but defensively a no-op): don't fire a
  network call.

## Testing

- `use-contact-custom-fields` (extend existing test coverage, or add
  `use-contact-custom-fields.test.ts` if none exists yet):
  - `updateFieldValue` with a non-empty value upserts and updates local state.
  - `updateFieldValue` with an empty/whitespace value deletes the row and
    removes the entry from local state.
  - `updateFieldValue` on a failed Supabase call returns `false` and leaves
    state unchanged.
- `CustomFieldValue`:
  - Non-editable (default / `editable=false`): renders read-only regardless
    of `onCommit` presence; no click handler attached.
  - Editable: click swaps to an input with the current value; Enter calls
    `onCommit` with the trimmed value; Escape reverts without calling
    `onCommit`.
  - `onCommit` resolving `false`: attempted value is kept (not reverted to
    the last-committed value), edit mode persists (input still shown).

## Non-goals / follow-ups (not part of this change)

- Tag editing from the inbox sidebar.
- Letting admins add a value for a field that has none yet, from the sidebar.
- Any change to `contact_custom_values` RLS policy.
