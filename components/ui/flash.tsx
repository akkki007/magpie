"use client";

import { useEffect, useRef } from "react";

import { toast } from "@/components/ui/toast";

/**
 * Fires a one-off toast for something that happened on the *previous* page.
 *
 * Server Actions that end in `redirect()` cannot show a toast themselves — the
 * component that called them is gone by the time the new page renders. So the
 * action leaves a marker in the query string and the destination page renders
 * this.
 *
 * **The message is a prop, never the query string.** A component that toasted
 * `?message=...` would let anyone send a link that makes our own UI say
 * anything they like — "Your account was suspended, call this number" in
 * Magpie's own chrome. The page maps a known flag to a fixed sentence; the URL
 * only ever carries the flag.
 */
export function Flash({
  message,
  param,
}: {
  message: string;
  param: string;
}) {
  // Effects run twice in development's strict mode, and a toast that appears
  // twice looks like the action ran twice.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    toast(message);

    // Drop the flag so a refresh — or a shared link — does not replay it.
    // `replaceState` leaves no history entry, so Back still goes back.
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [message, param]);

  return null;
}
