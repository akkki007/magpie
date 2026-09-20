"use client";

import { useActionState } from "react";

import { signUp } from "@/app/(auth)/actions";
import { emptyAuthState } from "@/app/(auth)/form-state";
import { Field, FormError, SubmitButton } from "@/components/auth/controls";

export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signUp, emptyAuthState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Name"
        name="name"
        autoComplete="name"
        defaultValue={state.values.name}
        error={state.errors.name}
        required
      />
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
        autoComplete="new-password"
        minLength={12}
        hint="At least 12 characters. A phrase beats a puzzle."
        error={state.errors.password}
        required
      />

      <FormError message={state.errors.form} />

      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
