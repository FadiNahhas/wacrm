"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomField, ContactCustomValue } from "@/types";

export interface ContactCustomFieldEntry {
  id: string;
  field_name: string;
  value: string;
}

/**
 * Field-name substrings (English + Hebrew synonyms) that identify a
 * contact at a glance and should surface first — in the chat header and
 * at the top of the sidebar's custom-fields list — ahead of every other
 * account-defined field. Matched case-insensitively against `field_name`,
 * in priority order. Add synonyms here rather than special-casing a
 * specific account's field catalogue.
 */
const PRIORITY_FIELD_MATCHERS = [
  "role",
  "תפקיד",
  "school",
  "בית ספר",
  "town",
  "city",
  "עיר",
  "יישוב",
  "ישוב",
] as const;

function priorityRank(fieldName: string): number {
  const lower = fieldName.toLowerCase();
  const idx = PRIORITY_FIELD_MATCHERS.findIndex((m) => lower.includes(m));
  return idx === -1 ? PRIORITY_FIELD_MATCHERS.length : idx;
}

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

/**
 * Fetches the account's custom-field catalogue plus this contact's values
 * and joins them client-side (same query shape as
 * `contact-detail-view.tsx`'s `fetchCustomFields`), so the chat header and
 * the contact sidebar can share a single fetch per contact switch instead
 * of each independently querying the same rows.
 */
export function useContactCustomFields(contactId: string | null | undefined) {
  const [fields, setFields] = useState<ContactCustomFieldEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFields = useCallback(async () => {
    if (!contactId) {
      setFields([]);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from("custom_fields").select("*").order("field_name"),
      supabase
        .from("contact_custom_values")
        .select("*")
        .eq("contact_id", contactId),
    ]);

    if (fieldsRes.error || valuesRes.error) {
      console.error(
        "Failed to fetch contact custom fields:",
        fieldsRes.error ?? valuesRes.error,
      );
      setFields([]);
      setLoading(false);
      return;
    }

    const fieldsById = new Map<string, CustomField>();
    for (const f of (fieldsRes.data as CustomField[]) ?? []) {
      fieldsById.set(f.id, f);
    }

    const entries: ContactCustomFieldEntry[] = [];
    for (const v of (valuesRes.data as ContactCustomValue[]) ?? []) {
      const value = v.value?.trim();
      if (!value) continue;
      const field = fieldsById.get(v.custom_field_id);
      if (!field) continue;
      entries.push({ id: field.id, field_name: field.field_name, value });
    }

    entries.sort((a, b) => {
      const rankDiff = priorityRank(a.field_name) - priorityRank(b.field_name);
      if (rankDiff !== 0) return rankDiff;
      return a.field_name.localeCompare(b.field_name);
    });

    setFields(entries);
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFields();
  }, [fetchFields]);

  const priorityFields = fields.filter(
    (f) => priorityRank(f.field_name) < PRIORITY_FIELD_MATCHERS.length,
  );

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

  return { fields, priorityFields, loading, updateFieldValue };
}
