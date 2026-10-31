"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Loader2, MessageSquare, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { QuickReply } from "@/types";
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive";

interface QuickReplyPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (qr: QuickReply) => void;
}

/*
 * Tab-wide quick-reply cache (stale-while-revalidate).
 *
 * The picker used to start from an empty list and hit /api/quick-replies
 * on every open — browser → Next route → auth.getUser + profile lookup →
 * the query itself, all behind a spinner. Now:
 *   - the list is read straight from Supabase in the browser (RLS policy
 *     quick_replies_select already scopes it to the account, exactly as
 *     the GET route relied on), so it's a single round trip;
 *   - it's warmed when the composer mounts, so the first open is usually
 *     instant;
 *   - later opens render the cached list immediately and refresh it in
 *     the background, so edits made in Settings still show up.
 */
let cachedQuickReplies: QuickReply[] | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => cachedQuickReplies;
const getServerSnapshot = () => null;

/** Fetch the account's quick replies into the shared cache. Concurrent
 *  calls share one request. */
export function refreshQuickReplies(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await createClient()
        .from("quick_replies")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Failed to load quick replies:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        // Keep whatever we had; a first-load failure shows the empty
        // state rather than spinning forever.
        cachedQuickReplies ??= [];
      } else {
        cachedQuickReplies = (data ?? []) as QuickReply[];
      }
      listeners.forEach((l) => l());
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Lists the account's saved quick replies for insertion into the
 * composer. Text snippets fill the textarea; interactive snippets open
 * the builder pre-filled (handled by the caller's `onPick`).
 */
export function QuickReplyPicker({
  open,
  onOpenChange,
  onPick,
}: QuickReplyPickerProps) {
  const t = useTranslations("Inbox.composer");
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Warm the cache as soon as a composer is on screen.
  useEffect(() => {
    if (cachedQuickReplies === null) void refreshQuickReplies();
  }, []);

  // Revalidate on every open; the cached list renders meanwhile.
  useEffect(() => {
    if (open) void refreshQuickReplies();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("quickReplies")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {items === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("quickRepliesEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((qr) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onClick={() => onPick(qr)}
                    className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                  >
                    {qr.kind === "interactive" ? (
                      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {qr.title}
                      </span>
                      <span dir="auto" className="message-text block truncate text-xs text-muted-foreground">
                        {qr.kind === "interactive" && qr.interactive_payload
                          ? interactivePayloadPreviewText(qr.interactive_payload)
                          : qr.content_text}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
