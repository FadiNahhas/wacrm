"use client";

import { BidiText } from "@/components/ui/bidi-text";

import { List, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";

/**
 * WhatsApp-style read-only render of an interactive message. Used both
 * in the builder's live preview and by the inbox message bubble so a
 * sent buttons/list message shows the same way it does on the phone.
 *
 * Purely presentational — the buttons/rows are not clickable here (the
 * customer taps them on their own device). Kept namespace-free (plain
 * English) so it can be dropped into the composer, the automation
 * builder, and the quick-replies manager without namespace coupling.
 */
export function InteractivePreview({
  payload,
  className,
}: {
  payload: InteractiveMessagePayload;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-[260px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
    >
      <div className="px-3 py-2">
        {payload.header ? (
          <p dir="auto" className="message-text mb-1 break-words text-sm font-semibold">
            <BidiText>{payload.header}</BidiText>
          </p>
        ) : null}
        <p dir="auto" className="message-text whitespace-pre-wrap break-words text-sm">
          {payload.body ? <BidiText>{payload.body}</BidiText> : (
            <span className="text-muted-foreground">Message body…</span>
          )}
        </p>
        {payload.footer ? (
          <p dir="auto" className="message-text mt-1 break-words text-[11px] text-muted-foreground">
            <BidiText>{payload.footer}</BidiText>
          </p>
        ) : null}
      </div>

      {payload.kind === "buttons" ? (
        <div className="flex flex-col border-t border-border">
          {payload.buttons.map((b, i) => (
            <button
              key={b.id || i}
              type="button"
              disabled
              className="flex items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary first:border-t-0"
            >
              <Reply className="h-3.5 w-3.5" />
              <bdi className="min-w-0 truncate">{b.title || "Button"}</bdi>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <List className="h-3.5 w-3.5" />
          <bdi className="min-w-0 truncate">{payload.button_label || "Menu"}</bdi>
        </button>
      )}
    </div>
  );
}
