"use client";

import { useActionState } from "react";

import { requestMagicLink } from "@/app/(auth)/actions";
import { emptyMagicLinkState } from "@/app/(auth)/form-state";
import { Field, FormError, SubmitButton } from "@/components/auth/controls";

export function MagicLinkForm({
  next,
  expiresInMinutes,
}: {
  next?: string;
  expiresInMinutes: number;
}) {
  const [state, formAction] = useActionState(
    requestMagicLink,
    emptyMagicLinkState,
  );

  // The success screen replaces the form rather than sitting above it. Leaving
  // the form in place invites a second submit, and a second link silently
  // invalidates the first — which reads as "the link is broken".
  if (state.sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-ink-2">
          If <span className="font-medium text-ink">{state.email}</span> can sign
          in, a link is on its way.
        </p>
        <p className="text-[13px] text-ink-muted">
          It expires in {expiresInMinutes} minutes and works once. Check spam
          before asking for another — a new link cancels the old one.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.email}
        error={state.errors.email}
        required
      />

      <FormError message={state.errors.form} />

      <SubmitButton>Email me a link</SubmitButton>
    </form>
  );
}
