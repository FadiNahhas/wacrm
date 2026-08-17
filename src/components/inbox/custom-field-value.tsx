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
