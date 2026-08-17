# Inline-Edit Custom Fields in Inbox Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins and owners edit a contact's custom field values directly from the inbox contact sidebar, without leaving the inbox for the Contacts page.

**Architecture:** Extend the existing shared `useContactCustomFields` hook (already used by both `ContactSidebar` and `MessageThread`'s header preview) with a single-row upsert/delete write path, and extend the existing `CustomFieldValue` display component with an optional click-to-edit mode. `ContactSidebar` gates the edit affordance on `useAuth().canEditSettings` (admin+owner) and threads the write function down from `inbox/page.tsx`, which owns the hook instance.

**Tech Stack:** Next.js (App Router), React, TypeScript, Supabase (`@supabase/ssr` browser client), next-intl, Tailwind, sonner (toasts), Vitest.

## Global Constraints

- Editable only when `useAuth().canEditSettings` is true (admin or owner) — from `src/lib/auth/roles.ts`'s `canEditSettings()`, exposed as `AuthContextValue.canEditSettings`. Viewers/agents always get today's read-only rendering.
- Editing is scoped to fields the sidebar already displays (non-empty value for this contact). No UI for adding a value to a field that currently has none — that stays a Contacts-page-only action.
- Single-row writes only: upsert on `contact_custom_values`'s existing `UNIQUE(contact_id, custom_field_id)` constraint (`supabase/migrations/001_initial_schema.sql:108-115`) for non-empty values; delete the row when cleared to empty. Never use the "delete all values for this contact, then reinsert everything" bulk pattern from `contact-detail-view.tsx`.
- No RLS changes. No changes to `MessageThread`'s header preview (stays read-only) or to tags (out of scope for this feature).
- This repo's Vitest config runs with `environment: "node"` (`vitest.config.ts`) — there is no jsdom / `@testing-library/react` in this project. Testable logic must be pure functions callable without rendering; the one existing exception (`src/components/ui/dropdown-menu-group-label.test.tsx`) uses `react-dom/server`'s `renderToStaticMarkup` for a narrow "does it throw" smoke check, not interaction testing. Follow that same convention here — do not add jsdom/testing-library as part of this feature.
- Match the existing Supabase-mock test convention from `src/lib/auth/account.test.ts`: `vi.mock` the client module so `createClient()` returns a hand-rolled chainable fake, and assert on captured calls — don't inject the client as a function parameter (this codebase doesn't do that).
- i18n: every new user-facing string needs both an `en.json` and a `ko.json` entry under `Inbox.sidebar`.

---

### Task 1: Hook — single-row write path on `useContactCustomFields`

**Files:**
- Modify: `src/hooks/use-contact-custom-fields.ts`
- Test: `src/hooks/use-contact-custom-fields.test.ts` (new file)

**Interfaces:**
- Produces: `writeCustomFieldValue(contactId: string, fieldId: string, newValue: string): Promise<boolean>` — exported pure async function, no React dependency, callable directly in tests.
- Produces: `useContactCustomFields(contactId)` return value gains `updateFieldValue(fieldId: string, newValue: string): Promise<boolean>` alongside the existing `fields`, `priorityFields`, `loading`.
- Consumes: nothing new — reuses the existing `createClient` import from `@/lib/supabase/client` and the existing `ContactCustomFieldEntry` type declared in this same file.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/use-contact-custom-fields.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// Mirrors the Supabase-mock convention in src/lib/auth/account.test.ts:
// mock the client module, hand back a chainable fake, assert on captured
// calls. This hook's write path (writeCustomFieldValue) is a plain async
// function with no React dependency, so it's testable directly — no
// renderHook/jsdom needed (this repo's vitest.config.ts runs with
// environment: "node").

interface BuilderCall {
  table: string;
  method: "upsert" | "delete" | null;
  upsertArgs?: [Record<string, unknown>, Record<string, unknown> | undefined];
  eqArgs: [string, unknown][];
}

function makeClient(opts: { error?: { message: string } | null } = {}) {
  const calls: BuilderCall[] = [];

  function from(table: string) {
    const call: BuilderCall = { table, method: null, eqArgs: [] };
    const builder = {
      upsert(row: Record<string, unknown>, options?: Record<string, unknown>) {
        call.method = "upsert";
        call.upsertArgs = [row, options];
        return builder;
      },
      delete() {
        call.method = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      then(
        resolve: (value: { error: unknown }) => void,
        reject: (reason: unknown) => void,
      ) {
        calls.push(call);
        Promise.resolve({ error: opts.error ?? null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { calls, client: { from } };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createClient(),
}));

const { writeCustomFieldValue } = await import("./use-contact-custom-fields");

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeCustomFieldValue", () => {
  it("upserts a trimmed non-empty value on the (contact_id, custom_field_id) key", async () => {
    const { client, calls } = makeClient();
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "  כן  ");

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "contact_custom_values",
      method: "upsert",
      upsertArgs: [
        { contact_id: "contact-1", custom_field_id: "field-1", value: "כן" },
        { onConflict: "contact_id,custom_field_id" },
      ],
    });
  });

  it("deletes the row when the value is empty or whitespace-only", async () => {
    const { client, calls } = makeClient();
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "   ");

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "contact_custom_values",
      method: "delete",
      eqArgs: [
        ["contact_id", "contact-1"],
        ["custom_field_id", "field-1"],
      ],
    });
  });

  it("returns false when the upsert fails", async () => {
    const { client } = makeClient({ error: { message: "denied" } });
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "value");

    expect(ok).toBe(false);
  });

  it("returns false when the delete fails", async () => {
    const { client } = makeClient({ error: { message: "denied" } });
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "");

    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/use-contact-custom-fields.test.ts`
Expected: FAIL — `writeCustomFieldValue` is not exported yet (module has no such name).

- [ ] **Step 3: Implement `writeCustomFieldValue` and `updateFieldValue`**

In `src/hooks/use-contact-custom-fields.ts`, add the new export after the existing `priorityRank` function (i.e. right before `export function useContactCustomFields`):

```ts
/**
 * Writes one contact's value for one custom field. Non-empty values upsert
 * on the table's existing `UNIQUE(contact_id, custom_field_id)` constraint
 * (supabase/migrations/001_initial_schema.sql); clearing to empty deletes
 * the row instead, matching the "empty means no row" rule `fetchFields`
 * already applies when reading. Exported standalone (not a hook) so it's
 * testable without rendering — this repo's vitest config has no jsdom.
 */
export async function writeCustomFieldValue(
  contactId: string,
  fieldId: string,
  newValue: string,
): Promise<boolean> {
  const supabase = createClient();
  const trimmed = newValue.trim();

  if (!trimmed) {
    const { error } = await supabase
      .from("contact_custom_values")
      .delete()
      .eq("contact_id", contactId)
      .eq("custom_field_id", fieldId);
    return !error;
  }

  const { error } = await supabase.from("contact_custom_values").upsert(
    { contact_id: contactId, custom_field_id: fieldId, value: trimmed },
    { onConflict: "contact_id,custom_field_id" },
  );
  return !error;
}
```

Then inside `useContactCustomFields`, add `updateFieldValue` right before the `return` statement at the end of the function:

```ts
  const updateFieldValue = useCallback(
    async (fieldId: string, newValue: string): Promise<boolean> => {
      if (!contactId) return false;
      const ok = await writeCustomFieldValue(contactId, fieldId, newValue);
      if (!ok) return false;

      const trimmed = newValue.trim();
      setFields((prev) =>
        trimmed
          ? prev.map((f) => (f.id === fieldId ? { ...f, value: trimmed } : f))
          : prev.filter((f) => f.id !== fieldId),
      );
      return true;
    },
    [contactId],
  );
```

And update the final `return` statement to include it:

```ts
  return { fields, priorityFields, loading, updateFieldValue };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/use-contact-custom-fields.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-contact-custom-fields.ts src/hooks/use-contact-custom-fields.test.ts
git commit -m "feat(inbox): add single-row write path to useContactCustomFields"
```

---

### Task 2: Component — editable mode on `CustomFieldValue`

**Files:**
- Modify: `src/components/inbox/custom-field-value.tsx`
- Test: `src/components/inbox/custom-field-value.test.tsx` (new file)
- Modify: `messages/en.json`
- Modify: `messages/ko.json`

**Interfaces:**
- Consumes: `SettingsChip` from `src/components/settings/settings-chip.tsx` (`variant?: 'owner' | 'admin' | 'ok' | 'warn' | 'muted'`, `className?: string`, `children: ReactNode`) — unchanged, already imported.
- Produces: `CustomFieldValue` gains two new optional props: `editable?: boolean` and `onCommit?: (newValue: string) => Promise<boolean>`. Existing `value: string` and `className?: string` props are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/inbox/custom-field-value.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomFieldValue } from "./custom-field-value";

// Static-render smoke tests only, matching the existing convention in
// src/components/ui/dropdown-menu-group-label.test.tsx — this repo's
// vitest config has no jsdom, so click/keyboard interaction (edit mode
// entry, Enter/Escape handling, onCommit firing) is verified by hand in
// the browser, not here. These tests just pin that neither rendering mode
// throws and that the display value survives into the markup.

describe("CustomFieldValue", () => {
  it("renders read-only chip markup for a כן value without throwing", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomFieldValue, { value: "כן" }),
    );
    expect(html).toContain("כן");
    expect(html).not.toMatch(/<button/);
  });

  it("renders read-only plain text for a non-flag value without throwing", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomFieldValue, { value: "Tel Aviv" }),
    );
    expect(html).toContain("Tel Aviv");
    expect(html).not.toMatch(/<button/);
  });

  it("stays read-only when editable is true but onCommit is absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomFieldValue, { value: "לא", editable: true }),
    );
    expect(html).not.toMatch(/<button/);
  });

  it("wraps the value in a clickable button when editable with onCommit", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomFieldValue, {
        value: "Tel Aviv",
        editable: true,
        onCommit: async () => true,
      }),
    );
    expect(html).toMatch(/<button/);
    expect(html).toContain("Tel Aviv");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inbox/custom-field-value.test.tsx`
Expected: FAIL — the current component takes only `{value, className}` and always returns a chip/span, never a `<button>` (unknown props like `editable`/`onCommit` are silently ignored by React, not type-checked at vitest's transpile step). The last test's `expect(html).toMatch(/<button/)` assertion fails against today's implementation — that's the real signal here, not a throw.

- [ ] **Step 3: Implement editable mode**

Replace the full contents of `src/components/inbox/custom-field-value.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SettingsChip } from "@/components/settings/settings-chip";
import { cn } from "@/lib/utils";

const AFFIRMATIVE_VALUES = new Set(["כן", "yes", "true"]);
const NEGATIVE_VALUES = new Set(["לא", "no", "false"]);

function flagTone(value: string): "yes" | "no" | null {
  const normalized = value.trim().toLowerCase();
  if (AFFIRMATIVE_VALUES.has(normalized)) return "yes";
  if (NEGATIVE_VALUES.has(normalized)) return "no";
  return null;
}

/**
 * Renders a single custom field's value: a green/grey badge for
 * boolean-style values (כן/לא, yes/no), plain text otherwise. `dir="auto"`
 * lets the browser pick RTL/LTR per the Unicode bidi algorithm since the
 * app has no global RTL support to hook into — field values are
 * user-entered Hebrew/Arabic/English data, not app-locale strings.
 *
 * When `editable` is true and `onCommit` is provided, clicking the value
 * swaps it for a text input (admin/owner-only inline editing from the
 * inbox sidebar — see docs/superpowers/specs/2026-08-17-inbox-custom-fields-editing-design.md).
 * Enter or blur commits; Escape reverts without saving. A failed commit
 * reverts the input to the attempted text and stays in edit mode so the
 * admin can retry without retyping.
 */
export function CustomFieldValue({
  value,
  className,
  editable = false,
  onCommit,
}: {
  value: string;
  className?: string;
  editable?: boolean;
  onCommit?: (newValue: string) => Promise<boolean>;
}) {
  const t = useTranslations("Inbox.sidebar");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (editable && onCommit && isEditing) {
    async function commit() {
      const trimmed = draft.trim();
      if (trimmed === value.trim()) {
        setDraft(value);
        setIsEditing(false);
        return;
      }
      setSaving(true);
      const ok = await onCommit!(trimmed);
      setSaving(false);
      if (ok) {
        setIsEditing(false);
      } else {
        toast.error(t("customFieldSaveFailed"));
        setDraft(trimmed);
      }
    }

    return (
      <input
        autoFocus
        dir="auto"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(value);
            setIsEditing(false);
          }
        }}
        className={cn(
          "rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary/50",
          className,
        )}
      />
    );
  }

  const tone = flagTone(value);
  const display = tone ? (
    <SettingsChip variant={tone === "yes" ? "ok" : "muted"} className={className}>
      <span dir="auto">{value}</span>
    </SettingsChip>
  ) : (
    <span dir="auto" className={cn("text-xs text-foreground", className)}>
      {value}
    </span>
  );

  if (!editable || !onCommit) {
    return display;
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
      title={t("customFieldEditHint")}
      className="cursor-text rounded outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
    >
      {display}
    </button>
  );
}
```

- [ ] **Step 4: Add the new i18n keys**

In `messages/en.json`, inside the `Inbox.sidebar` object (right after the existing `"customFields": "Custom fields",` line):

```json
      "customFields": "Custom fields",
      "customFieldEditHint": "Click to edit",
      "customFieldSaveFailed": "Couldn't save that field. Try again.",
```

In `messages/ko.json`, same location:

```json
      "customFields": "맞춤 필드",
      "customFieldEditHint": "클릭하여 수정",
      "customFieldSaveFailed": "필드를 저장하지 못했습니다. 다시 시도하세요.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/inbox/custom-field-value.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/components/inbox/custom-field-value.tsx src/components/inbox/custom-field-value.test.tsx`
Expected: no errors (warnings only if pre-existing elsewhere, none expected in these two files)

- [ ] **Step 7: Commit**

```bash
git add src/components/inbox/custom-field-value.tsx src/components/inbox/custom-field-value.test.tsx messages/en.json messages/ko.json
git commit -m "feat(inbox): add inline edit mode to CustomFieldValue"
```

---

### Task 3: Wiring — admin gate + prop threading through sidebar and page

**Files:**
- Modify: `src/components/inbox/contact-sidebar.tsx`
- Modify: `src/app/(dashboard)/inbox/page.tsx`

**Interfaces:**
- Consumes: `useAuth().canEditSettings: boolean` from `src/hooks/use-auth.tsx` (already exported, already used elsewhere in the app for admin+ gates). Consumes `updateFieldValue` produced by Task 1's `useContactCustomFields`. Consumes the `editable`/`onCommit` props produced by Task 2's `CustomFieldValue`.
- Produces: `ContactSidebarProps` gains `onUpdateCustomField?: (fieldId: string, value: string) => Promise<boolean>`.

- [ ] **Step 1: Wire `ContactSidebar` to accept and use the updater**

In `src/components/inbox/contact-sidebar.tsx`, update the props interface (currently at line 27-36):

```ts
interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * This contact's custom fields, already sorted with the "identifying"
   * ones (role/school/town) first. Fetched once by the page (shared with
   * the thread header) rather than queried again here, so switching
   * conversations doesn't fire two custom-fields queries per contact.
   */
  customFields?: ContactCustomFieldEntry[];
  /**
   * Persists a single custom field's value for the active contact. Owned
   * by the page (which owns the `useContactCustomFields` hook instance
   * shared with the message-thread header) and passed down so a save here
   * updates both surfaces without a refetch. Edit affordance itself is
   * gated on `useAuth().canEditSettings` below, not on whether this prop
   * is present.
   */
  onUpdateCustomField?: (fieldId: string, value: string) => Promise<boolean>;
}
```

Update the function signature (currently `export function ContactSidebar({ contact, customFields = [] }: ContactSidebarProps) {`):

```ts
export function ContactSidebar({
  contact,
  customFields = [],
  onUpdateCustomField,
}: ContactSidebarProps) {
```

Update the `useAuth()` destructure (currently `const { accountId } = useAuth();`):

```ts
  const { accountId, canEditSettings } = useAuth();
```

Update the Custom Fields section's `<CustomFieldValue>` call (currently):

```tsx
                      <CustomFieldValue
                        value={f.value}
                        className="max-w-32 shrink-0 truncate"
                      />
```

to:

```tsx
                      <CustomFieldValue
                        value={f.value}
                        className="max-w-32 shrink-0 truncate"
                        editable={canEditSettings}
                        onCommit={
                          onUpdateCustomField
                            ? (newValue) => onUpdateCustomField(f.id, newValue)
                            : undefined
                        }
                      />
```

- [ ] **Step 2: Pass the updater from the page**

In `src/app/(dashboard)/inbox/page.tsx`, update the hook destructure (currently at lines 56-57):

```ts
  const {
    fields: customFields,
    priorityFields: priorityCustomFields,
    updateFieldValue: updateCustomFieldValue,
  } = useContactCustomFields(activeContact?.id ?? null);
```

Update the `<ContactSidebar>` call (currently at line 643):

```tsx
            <ContactSidebar
              contact={activeContact}
              customFields={customFields}
              onUpdateCustomField={updateCustomFieldValue}
            />
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/components/inbox/contact-sidebar.tsx "src/app/(dashboard)/inbox/page.tsx"`
Expected: only the pre-existing warnings already present on `main` (unused `cn`/`User` imports in `contact-sidebar.tsx`, unused `toast` in `page.tsx`, unused `ScrollArea` in `message-thread.tsx`) — no new warnings or errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all tests including the two new files from Tasks 1 and 2.

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/contact-sidebar.tsx "src/app/(dashboard)/inbox/page.tsx"
git commit -m "feat(inbox): gate inline custom-field editing to admins in the sidebar"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and open the inbox**

Use the project's preview tooling (`.claude/launch.json` already has a `wacrm-dev` config from earlier work) to start `npm run dev` and open `/inbox`. This requires real Supabase credentials in `.env.local` (see `.env.local.example`) — if none are available in the current environment, skip to Step 3 and note that verification is deferred to the user.

- [ ] **Step 2: Exercise the feature as an admin/owner**

1. Open a conversation whose contact has at least one custom field with a value (e.g. a כן/לא field and a plain-text field).
2. Click a plain-text value → confirm it becomes a focused input pre-filled with the current text.
3. Change the text and press Enter → confirm it saves (no error toast) and reverts to display mode showing the new value.
4. Click a כן/לא chip → change it to the other value (e.g. type "לא" over "כן") → blur (click elsewhere) → confirm it re-renders as the opposite-colored chip.
5. Click a value, change it, press Escape → confirm it reverts to the original value without saving.
6. Clear a value to empty and commit → confirm the row disappears from the Custom Fields section (matches "empty fields aren't shown").
7. Switch to a different conversation and back → confirm the edited value persisted (re-fetched from the database, not just local state).
8. Check the message-thread header (if the edited field is one of the priority fields — role/school/town) → confirm it also reflects the new value without a page reload, since it shares the same hook instance.

- [ ] **Step 3: Exercise the feature as a non-admin (agent or viewer)**

Sign in as (or switch the test account's role to) an agent or viewer. Confirm custom field values in the sidebar render exactly as before this change — plain text/chips, no click affordance, no input ever appears.

- [ ] **Step 4: Report results**

Summarize what was verified (or, if credentials weren't available in this environment, state plainly that automated checks passed but live UI behavior needs a manual pass by the user — per this project's standing instruction not to claim UI success without actually exercising it).
