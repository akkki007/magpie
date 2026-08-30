"use client";

import { useActionState } from "react";

import { signIn } from "@/app/(auth)/actions";
import { emptyAuthState } from "@/app/(auth)/form-state";
import { Field, FormError, SubmitButton } from "@/components/auth/controls";

export function SignInForm({ next }: { next?: string }) {
  // `useActionState` keeps the action's return value as state, which is how a
  // failed submit can re-render with errors *and* the email still filled in.
  // Before hydration the form still posts and still works — the state is the
  // enhancement, not the mechanism.
  const [state, formAction] = useActionState(signIn, emptyAuthState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values.email}
        error={state.errors.email}
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        error={state.errors.password}
        required
      />

      <FormError message={state.errors.form} />

      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
