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
 */
export function CustomFieldValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const tone = flagTone(value);

  if (tone) {
    return (
      <SettingsChip variant={tone === "yes" ? "ok" : "muted"} className={className}>
        <span dir="auto">{value}</span>
      </SettingsChip>
    );
  }

  return (
    <span dir="auto" className={cn("text-xs text-foreground", className)}>
      {value}
    </span>
  );
}
