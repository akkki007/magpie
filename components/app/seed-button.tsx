"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * The button an empty state offers instead of a shell command.
 *
 * One component for all three seeds, taking the action as a prop, because the differences
 * between them are entirely in the server: what to write and what to refuse. What the user
 * sees is the same in each case — a button, a spinner, and either a populated screen or a
 * reason it did not happen.
 *
 * ── Why `router.refresh()` on top of `revalidatePath` ─────────────────────────
 * The action revalidates the cache, which is what makes the *next* visit correct. It does not
 * re-render the page that is currently on screen — so without this the seed succeeds, the
 * toast confirms it, and the empty state stays exactly where it was, which reads as a button
 * that did nothing. `refresh()` re-requests the server component tree the user is looking at.
 */
export function SeedButton({
  action,
  label,
  pendingLabel = "Seeding…",
  className,
}: {
  /** A Server Action. Bound by the caller so this component knows nothing about seeds. */
  action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await action();
          if (result.ok) {
            toast.success("Seeded", { description: result.message });
            router.refresh();
          } else {
            // Named rather than generic: the refusal is usually "it already exists", and
            // the failure is usually a database the user can do something about.
            toast.error("Nothing was seeded", { description: result.error });
          }
        })
      }
      className={cn(
        "inline-flex min-h-[38px] items-center justify-center gap-2 rounded-button px-3 py-2",
        "text-[13px] font-medium transition-colors duration-150",
        pending
          ? "cursor-not-allowed bg-muted text-ink-muted"
          : "bg-ink text-white hover:bg-ink-2",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden />
      ) : (
        <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}
