import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;

  return (
    <div className="rounded-card border border-line bg-surface p-8 shadow-e1">
      <h1 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
        Create your account
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-muted">
        Takes a minute. You can invite the rest of the team afterwards.
      </p>

      <SignUpForm next={typeof next === "string" ? next : undefined} />

      <p className="mt-6 text-[13px] text-ink-muted">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
