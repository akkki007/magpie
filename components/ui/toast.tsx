"use client";

import { Toaster as Sonner } from "sonner";

export { toast } from "sonner";

/**
 * Toasts, on the design system.
 *
 * **What a toast is for here:** confirming something that already happened and
 * that the user cannot see on screen — "signed out", "invite sent", "copied".
 * Nothing else.
 *
 * **What it is not for:** form errors. Those go inline under the field they
 * belong to (docs/auth-plan.md §7). A toast that says "invalid email" floats
 * away from the input it is about, disappears on a timer, and is invisible to
 * someone who tabbed back to fix the field. If a message tells the user to *do*
 * something, it belongs next to the thing they must do.
 *
 * Styling is `unstyled` plus our own classes rather than Sonner's defaults,
 * because the defaults ship their own greys and shadows and this system is
 * hairlines on white. Colour stays out of it except for the status icon —
 * `docs/design-system.md` is explicit that colour is information.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      // Long enough to read a sentence twice, short enough not to sit there.
      duration={4000}
      gap={8}
      offset={20}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            "flex w-full items-start gap-2.5 rounded-card border border-line",
            // The one place a real shadow is allowed: it floats above the page,
            // so a hairline alone leaves it looking pasted on.
            "bg-surface px-3.5 py-3 shadow-e2",
            "font-sans text-[13px] leading-[18px] text-ink",
          ].join(" "),
          title: "font-medium",
          description: "mt-0.5 text-ink-muted",
          // Sonner renders the status glyph in a `[data-icon]` wrapper.
          icon: "mt-px shrink-0 [&>svg]:h-4 [&>svg]:w-4",
          success: "[&_[data-icon]]:text-pos-fg",
          error: "[&_[data-icon]]:text-neg-fg",
          actionButton:
            "ml-auto shrink-0 rounded-button bg-blue-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-blue-700",
          cancelButton:
            "ml-auto shrink-0 rounded-button bg-muted px-2 py-1 text-[12px] font-medium text-ink hover:bg-hover",
        },
      }}
    />
  );
}
