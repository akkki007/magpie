import type { Metadata } from "next";
import Link from "next/link";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { MAGIC_LINK_MINUTES } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in with a link" };

/**
 * A page of its own rather than a toggle on `/sign-in`.
 *
 * A toggle would be client state, so with JavaScript blocked or still loading
 * there would be no way to reach the second form. Two pages both work as plain
 * HTML, and each card stays single-purpose — which is also the design system's
 * position on auth screens.
 *
 * This page doubles as the failure landing for a link that no longer works:
 * Better Auth redirects here with `?error=` when verification fails.
 */
export default async function MagicLinkPage({
  searchParams,
}: PageProps<"/sign-in/link">) {
  const { next, error } = await searchParams;

  return (
    <div className="rounded-card border border-line bg-surface p-8 shadow-e1">
      <h1 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
        Sign in with a link
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-muted">
        We&rsquo;ll email you a one-time link. No password to remember.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-neg-fg/20 bg-neg-bg px-3 py-2 text-[13px] text-neg-fg"
        >
          {/* Expired, already used, and tampered-with all arrive as the same
              code — and should read as the same sentence, because the fix is
              identical and the difference is only useful to an attacker. */}
          That link has expired or was already used. Here&rsquo;s a fresh one.
        </p>
      )}

      <MagicLinkForm
        next={typeof next === "string" ? next : undefined}
        expiresInMinutes={MAGIC_LINK_MINUTES}
      />

      <p className="mt-6 text-[13px] text-ink-muted">
        Prefer a password?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Sign in with one
        </Link>
      </p>
    </div>
  );
}
