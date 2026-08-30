import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/components/auth/sign-in-form";
import { Flash } from "@/components/ui/flash";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, "signed-out": signedOut } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;

  return (
    <div className="rounded-card border border-line bg-surface p-8 shadow-e1">
      {/* Confirms something the user can no longer see: the session row is
          gone. The URL carries the flag; these words are chosen here. */}
      {signedOut && (
        <Flash param="signed-out" message="Signed out. Your session was deleted." />
      )}

      <h1 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
        Sign in to Magpie
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-muted">
        Your models and scenarios, where you left them.
      </p>

      <SignInForm next={nextPath} />

      {/* A hairline with the word set into it, rather than a heavier divider —
          elevation and separation in this system are both 1px. */}
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] text-ink-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {/* Secondary, and a plain link rather than a button: it navigates, and
          anything that navigates should be middle-clickable. */}
      <Link
        href={
          nextPath
            ? `/sign-in/link?next=${encodeURIComponent(nextPath)}`
            : "/sign-in/link"
        }
        className="flex h-10 w-full items-center justify-center rounded-control border border-line-strong bg-muted text-[14px] font-medium text-ink transition-colors hover:bg-hover"
      >
        Email me a sign-in link
      </Link>

      <p className="mt-6 text-[13px] text-ink-muted">
        No account yet?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
