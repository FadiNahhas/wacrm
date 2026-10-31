"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * One-tap copy for an activation key detected in a message (same parser
 * the Discord alert uses — see lib/automations/activation-key.ts).
 *
 * Rendered as an always-visible pill under the bubble rather than a hover
 * action: on phones a long-press selects the whole message, so copying
 * just the key was the painful part. Sized to a comfortable touch target
 * on mobile and compacted on sm+.
 */
export function ActivationKeyCopy({ activationKey }: { activationKey: string }) {
  const t = useTranslations("Inbox.bubble");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activationKey);
      setCopied(true);
      toast.success(t("keyCopied", { key: activationKey }));
    } catch {
      toast.error(t("copyKeyFailed"));
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t("copyKey", { key: activationKey })}
      title={t("copyKey", { key: activationKey })}
      className={cn(
        "mt-1 inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium shadow-xs transition-colors sm:h-7 sm:px-2.5",
        copied
          ? "border-primary/60 text-primary"
          : "border-border text-foreground hover:border-primary/50 hover:bg-muted active:bg-muted",
      )}
    >
      <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <bdi dir="ltr" className="font-mono tracking-wide">
        {activationKey}
      </bdi>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
